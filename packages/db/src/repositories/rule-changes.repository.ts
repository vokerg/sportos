import { scoreDay, type ActivityFact, type RuleChangePreview, type RulePreviewDay, type RuleProposal, type ScoringRule } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database, Json, ScoringRuleChange, ScoringRuleRow } from '../schema.js';

export type RuleChangeStatus = ScoringRuleChange['status'];

export interface RuleVersionReadModel extends ScoringRule {
  id: string;
  version: number;
  supersedesRuleId: string | null;
  createdAt: string;
}

export interface RuleChangeReadModel {
  id: string;
  ruleCode: string;
  previousRuleId: string | null;
  proposedRuleId: string;
  status: RuleChangeStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  initiatedBy: string;
  reason: string;
  proposal: RuleProposal;
  preview: RuleChangePreview;
  previewFingerprint: string;
  affectedFrom: string;
  affectedTo: string;
  error: { code: string; message: string } | null;
  result: Json;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ClaimedRuleChange {
  id: string;
  previousRuleId: string | null;
  proposedRuleId: string;
  affectedFrom: string;
  affectedTo: string;
  attemptCount: number;
  maxAttempts: number;
}

export class ActiveRuleChangeError extends Error {
  constructor(readonly changeId: string) {
    super(`Rule family already has active change ${changeId}.`);
    this.name = 'ActiveRuleChangeError';
  }
}

export class RuleOverlapError extends Error {
  constructor(readonly conflictingRuleId: string) {
    super(`Proposed effective range overlaps rule ${conflictingRuleId}.`);
    this.name = 'RuleOverlapError';
  }
}

export class RuleReplacementError extends Error {
  constructor(readonly code: 'RULE_NOT_FOUND' | 'RULE_CODE_MISMATCH' | 'RULE_NOT_ACTIVE' | 'INVALID_CUTOVER', message: string) {
    super(message);
    this.name = 'RuleReplacementError';
  }
}

export class RuleChangeStateError extends Error {
  constructor(readonly code: 'NOT_RETRYABLE' | 'ATTEMPTS_EXHAUSTED' | 'LOST_LEASE', message: string) {
    super(message);
    this.name = 'RuleChangeStateError';
  }
}

const QUEUE_ADVISORY_LOCK = 834_120_204;

export class RuleChangesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listRuleVersions(): Promise<RuleVersionReadModel[]> {
    const rows = await this.db
      .selectFrom('scoring_rules')
      .selectAll()
      .orderBy('code', 'asc')
      .orderBy('version', 'desc')
      .execute();
    return rows.map(toRuleVersion);
  }

  async listEnabledRules(): Promise<ScoringRule[]> {
    const rows = await this.db
      .selectFrom('scoring_rules')
      .selectAll()
      .where('enabled', '=', true)
      .orderBy('priority', 'asc')
      .orderBy('code', 'asc')
      .execute();
    return rows.map(toRuleVersion);
  }

  async latestMetricDate(): Promise<string | null> {
    const row = await this.db
      .selectFrom('daily_metrics')
      .select('metric_date')
      .orderBy('metric_date', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? dateString(row.metric_date) : null;
  }

  async listPreviewDays(from: string, to: string): Promise<RulePreviewDay[]> {
    const dailyRows = await this.db
      .selectFrom('daily_metrics')
      .selectAll()
      .where('metric_date', '>=', from)
      .where('metric_date', '<=', to)
      .orderBy('metric_date', 'asc')
      .execute();
    if (dailyRows.length === 0) return [];

    const dates = dailyRows.map((row) => dateString(row.metric_date));
    const activities = await this.db
      .selectFrom('activities')
      .selectAll()
      .where('activity_date', 'in', dates)
      .orderBy('activity_date', 'asc')
      .orderBy('id', 'asc')
      .execute();
    const byDate = new Map<string, ActivityFact[]>();
    for (const row of activities) {
      const activity = toActivityFact(row);
      const rows = byDate.get(activity.activityDate) ?? [];
      rows.push(activity);
      byDate.set(activity.activityDate, rows);
    }

    return dailyRows.map((row) => {
      const metricDate = dateString(row.metric_date);
      return {
        facts: {
          metricDate,
          steps: requiredNumber(row.steps),
          runM: requiredNumber(row.run_m),
          bikeM: requiredNumber(row.bike_m),
          swimM: requiredNumber(row.swim_m),
          workoutPoints: requiredNumber(row.workout_points),
          powerPoints: requiredNumber(row.power_points),
          excelAllPoints: optionalNumber(row.excel_all_points),
          excelRowHash: row.excel_row_hash ?? undefined,
        },
        activities: byDate.get(metricDate) ?? [],
        currentBasePoints: requiredNumber(row.base_points),
        currentBonusPoints: requiredNumber(row.bonus_points),
        currentTotalPoints: requiredNumber(row.total_points),
        recomputedAt: isoTimestamp(row.recomputed_at),
      };
    });
  }

  async enqueueChange(input: {
    proposal: RuleProposal;
    preview: RuleChangePreview;
    previewFingerprint: string;
    initiatedBy: string;
    reason: string;
    maxAttempts?: number;
  }): Promise<RuleChangeReadModel> {
    const { proposal, preview } = input;
    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${QUEUE_ADVISORY_LOCK})`.execute(transaction);

      const active = await transaction
        .selectFrom('scoring_rule_changes')
        .select('id')
        .where('rule_code', '=', proposal.code)
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirst();
      if (active) throw new ActiveRuleChangeError(active.id);

      let previous: ScoringRuleRow | undefined;
      if (proposal.replaceRuleId) {
        previous = await transaction
          .selectFrom('scoring_rules')
          .selectAll()
          .where('id', '=', proposal.replaceRuleId)
          .forUpdate()
          .executeTakeFirst();
        if (!previous) throw new RuleReplacementError('RULE_NOT_FOUND', 'The rule selected for replacement does not exist.');
        if (previous.code !== proposal.code) throw new RuleReplacementError('RULE_CODE_MISMATCH', 'Replacement rule must belong to the same rule code.');
        if (!previous.enabled) throw new RuleReplacementError('RULE_NOT_ACTIVE', 'Only an enabled rule version can be superseded.');
        if (proposal.validFrom <= dateString(previous.valid_from)) {
          throw new RuleReplacementError('INVALID_CUTOVER', 'A replacement must start after the previous version starts.');
        }
      }

      let overlapQuery = transaction
        .selectFrom('scoring_rules')
        .select('id')
        .where('code', '=', proposal.code)
        .where('enabled', '=', true)
        .where('valid_from', '<=', proposal.validTo ?? '9999-12-31')
        .where((eb) => eb.or([
          eb('valid_to', 'is', null),
          eb('valid_to', '>=', proposal.validFrom),
        ]));
      if (proposal.replaceRuleId) overlapQuery = overlapQuery.where('id', '!=', proposal.replaceRuleId);
      const overlap = await overlapQuery.executeTakeFirst();
      if (overlap) throw new RuleOverlapError(overlap.id);

      const versionRow = await transaction
        .selectFrom('scoring_rules')
        .select((eb) => eb.fn.max<number>('version').as('maximum'))
        .where('code', '=', proposal.code)
        .executeTakeFirstOrThrow();
      const nextVersion = Number(versionRow.maximum ?? 0) + 1;

      const proposed = await transaction
        .insertInto('scoring_rules')
        .values({
          code: proposal.code,
          version: nextVersion,
          supersedes_rule_id: proposal.replaceRuleId ?? null,
          name: proposal.name,
          activity_type: proposal.activityType,
          rule_kind: proposal.ruleKind,
          metric: proposal.metric,
          coefficient: proposal.coefficient ?? null,
          threshold_operator: proposal.thresholdOperator ?? null,
          threshold_value: proposal.thresholdValue ?? null,
          threshold_unit: proposal.thresholdUnit ?? null,
          points: proposal.points ?? null,
          valid_from: proposal.validFrom,
          valid_to: proposal.validTo ?? null,
          priority: proposal.priority,
          enabled: false,
          description: proposal.description ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const change = await transaction
        .insertInto('scoring_rule_changes')
        .values({
          rule_code: proposal.code,
          previous_rule_id: proposal.replaceRuleId ?? null,
          proposed_rule_id: proposed.id,
          status: 'queued',
          phase: 'queued',
          progress_percent: 0,
          attempt_count: 0,
          max_attempts: clampInteger(input.maxAttempts ?? 3, 1, 10),
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          cancellation_requested_at: null,
          next_attempt_at: new Date(),
          initiated_by: safeText(input.initiatedBy, 200, 'local-user'),
          reason: safeText(input.reason, 1000, 'Rule change requested.'),
          proposal_json: jsonb(proposal),
          preview_json: jsonb(preview),
          preview_fingerprint: input.previewFingerprint,
          affected_from: preview.affectedFrom,
          affected_to: preview.affectedTo,
          error_code: null,
          error_message: null,
          result_json: {},
          started_at: null,
          completed_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return this.getByIdUsing(transaction, change.id).then(requireChange);
    });
  }

  async listChanges(limit = 50): Promise<RuleChangeReadModel[]> {
    const rows = await this.db
      .selectFrom('scoring_rule_changes')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(clampInteger(limit, 1, 200))
      .execute();
    return rows.map(toRuleChange);
  }

  getById(changeId: string): Promise<RuleChangeReadModel | null> {
    return this.getByIdUsing(this.db, changeId);
  }

  async claimNext(workerId: string, leaseSeconds = 60): Promise<ClaimedRuleChange | null> {
    return this.db.transaction().execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom('scoring_rule_changes')
        .select(['id', 'previous_rule_id', 'proposed_rule_id', 'affected_from', 'affected_to'])
        .where('status', '=', 'queued')
        .where('next_attempt_at', '<=', new Date())
        .where('cancellation_requested_at', 'is', null)
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;

      const updated = await transaction
        .updateTable('scoring_rule_changes')
        .set({
          status: 'running',
          phase: 'claimed',
          progress_percent: 5,
          attempt_count: sql<number>`attempt_count + 1`,
          lease_owner: safeText(workerId, 200, 'sportos-worker'),
          lease_expires_at: sql<Date>`now() + make_interval(secs => ${clampInteger(leaseSeconds, 15, 600)})`,
          heartbeat_at: new Date(),
          updated_at: new Date(),
          started_at: sql<Date>`coalesce(started_at, now())`,
          completed_at: null,
          error_code: null,
          error_message: null,
        })
        .where('id', '=', candidate.id)
        .where('status', '=', 'queued')
        .returning(['attempt_count', 'max_attempts'])
        .executeTakeFirst();
      if (!updated) return null;

      return {
        id: candidate.id,
        previousRuleId: candidate.previous_rule_id,
        proposedRuleId: candidate.proposed_rule_id,
        affectedFrom: dateString(candidate.affected_from),
        affectedTo: dateString(candidate.affected_to),
        attemptCount: updated.attempt_count,
        maxAttempts: updated.max_attempts,
      };
    });
  }

  async heartbeat(changeId: string, workerId: string, phase: string, progressPercent: number, leaseSeconds = 60): Promise<void> {
    const updated = await this.db
      .updateTable('scoring_rule_changes')
      .set({
        phase: safeText(phase, 120, 'running'),
        progress_percent: sql<number>`greatest(progress_percent, ${clampInteger(progressPercent, 0, 99)})`,
        heartbeat_at: new Date(),
        lease_expires_at: sql<Date>`now() + make_interval(secs => ${clampInteger(leaseSeconds, 15, 600)})`,
        updated_at: new Date(),
      })
      .where('id', '=', changeId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', safeText(workerId, 200, 'sportos-worker'))
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new RuleChangeStateError('LOST_LEASE', 'The worker no longer owns this rule-change lease.');
  }

  async cancellationRequested(changeId: string, workerId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('scoring_rule_changes')
      .select('cancellation_requested_at')
      .where('id', '=', changeId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', safeText(workerId, 200, 'sportos-worker'))
      .executeTakeFirst();
    if (!row) throw new RuleChangeStateError('LOST_LEASE', 'The worker no longer owns this rule-change lease.');
    return row.cancellation_requested_at !== null;
  }

  async activateAndRecompute(changeId: string, workerId: string): Promise<{ datesRecomputed: number; proposedRuleId: string }> {
    return this.db.transaction().execute(async (transaction) => {
      const change = await transaction
        .selectFrom('scoring_rule_changes')
        .selectAll()
        .where('id', '=', changeId)
        .where('status', '=', 'running')
        .where('lease_owner', '=', safeText(workerId, 200, 'sportos-worker'))
        .forUpdate()
        .executeTakeFirst();
      if (!change) throw new RuleChangeStateError('LOST_LEASE', 'The worker cannot activate a rule after losing its lease.');
      if (change.cancellation_requested_at !== null) throw new RuleChangeCancelledError();

      const proposed = await transaction
        .selectFrom('scoring_rules')
        .selectAll()
        .where('id', '=', change.proposed_rule_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (proposed.enabled) throw new Error('Proposed rule version is already enabled.');

      if (change.previous_rule_id) {
        const previous = await transaction
          .selectFrom('scoring_rules')
          .selectAll()
          .where('id', '=', change.previous_rule_id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const cutoverEnd = previousDay(dateString(proposed.valid_from));
        if (dateString(previous.valid_from) > cutoverEnd) throw new Error('Rule cutover would create an invalid previous range.');
        if (previous.valid_to === null || dateString(previous.valid_to) >= dateString(proposed.valid_from)) {
          await transaction
            .updateTable('scoring_rules')
            .set({ valid_to: cutoverEnd })
            .where('id', '=', previous.id)
            .execute();
        }
      }

      await transaction
        .updateTable('scoring_rules')
        .set({ enabled: true })
        .where('id', '=', proposed.id)
        .execute();

      const rules = (await transaction
        .selectFrom('scoring_rules')
        .selectAll()
        .where('enabled', '=', true)
        .execute()).map(toRuleVersion);
      const dailyRows = await transaction
        .selectFrom('daily_metrics')
        .selectAll()
        .where('metric_date', '>=', change.affected_from)
        .where('metric_date', '<=', change.affected_to)
        .orderBy('metric_date', 'asc')
        .execute();
      const dates = dailyRows.map((row) => dateString(row.metric_date));
      const activityRows = dates.length === 0 ? [] : await transaction
        .selectFrom('activities')
        .selectAll()
        .where('activity_date', 'in', dates)
        .orderBy('activity_date', 'asc')
        .orderBy('id', 'asc')
        .execute();
      const activitiesByDate = new Map<string, ActivityFact[]>();
      for (const row of activityRows) {
        const activity = toActivityFact(row);
        const activities = activitiesByDate.get(activity.activityDate) ?? [];
        activities.push(activity);
        activitiesByDate.set(activity.activityDate, activities);
      }

      for (const row of dailyRows) {
        const metricDate = dateString(row.metric_date);
        const facts = {
          metricDate,
          steps: requiredNumber(row.steps),
          runM: requiredNumber(row.run_m),
          bikeM: requiredNumber(row.bike_m),
          swimM: requiredNumber(row.swim_m),
          workoutPoints: requiredNumber(row.workout_points),
          powerPoints: requiredNumber(row.power_points),
          excelAllPoints: optionalNumber(row.excel_all_points),
          excelRowHash: row.excel_row_hash ?? undefined,
        };
        const score = scoreDay(facts, activitiesByDate.get(metricDate) ?? [], rules);
        await transaction
          .updateTable('daily_metrics')
          .set({
            base_points: score.basePoints,
            bonus_points: score.bonusPoints,
            total_points: score.totalPoints,
            recomputed_at: new Date(),
          })
          .where('metric_date', '=', metricDate)
          .execute();
        await transaction.deleteFrom('score_ledger').where('metric_date', '=', metricDate).execute();
        if (score.ledger.length > 0) {
          await transaction
            .insertInto('score_ledger')
            .values(score.ledger.map((entry) => ({
              metric_date: entry.metricDate,
              activity_id: entry.activityId ?? null,
              rule_id: entry.ruleId ?? null,
              points: entry.points,
              reason: entry.reason,
              calculation_json: entry.calculationJson as Json,
            })))
            .execute();
        }
      }

      const result = { datesRecomputed: dailyRows.length, proposedRuleId: proposed.id };
      await transaction
        .updateTable('scoring_rule_changes')
        .set({
          status: 'succeeded',
          phase: 'completed',
          progress_percent: 100,
          result_json: jsonb(result),
          error_code: null,
          error_message: null,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: new Date(),
          completed_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', change.id)
        .execute();
      return result;
    });
  }

  async markFailed(changeId: string, workerId: string, code: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await this.db
      .updateTable('scoring_rule_changes')
      .set({
        status: 'failed',
        phase: 'failed',
        error_code: safeCode(code),
        error_message: redactSensitiveText(message).slice(0, 500),
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: new Date(),
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', changeId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', safeText(workerId, 200, 'sportos-worker'))
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new RuleChangeStateError('LOST_LEASE', 'The worker cannot fail a rule change after losing its lease.');
  }

  async markCancelled(changeId: string, workerId: string): Promise<void> {
    const updated = await this.db
      .updateTable('scoring_rule_changes')
      .set({
        status: 'cancelled',
        phase: 'cancelled',
        error_code: null,
        error_message: null,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: new Date(),
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', changeId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', safeText(workerId, 200, 'sportos-worker'))
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new RuleChangeStateError('LOST_LEASE', 'The worker cannot cancel a rule change after losing its lease.');
  }

  async requestCancellation(changeId: string): Promise<RuleChangeReadModel | null> {
    return this.db.transaction().execute(async (transaction) => {
      const change = await transaction
        .selectFrom('scoring_rule_changes')
        .selectAll()
        .where('id', '=', changeId)
        .forUpdate()
        .executeTakeFirst();
      if (!change) return null;
      if (change.status === 'queued') {
        await transaction
          .updateTable('scoring_rule_changes')
          .set({
            status: 'cancelled',
            phase: 'cancelled',
            cancellation_requested_at: new Date(),
            completed_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', changeId)
          .execute();
      } else if (change.status === 'running' && change.cancellation_requested_at === null) {
        await transaction
          .updateTable('scoring_rule_changes')
          .set({ cancellation_requested_at: new Date(), phase: 'cancelling', updated_at: new Date() })
          .where('id', '=', changeId)
          .execute();
      }
      return this.getByIdUsing(transaction, changeId).then(requireChange);
    });
  }

  async retry(changeId: string): Promise<RuleChangeReadModel | null> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${QUEUE_ADVISORY_LOCK})`.execute(transaction);
      const change = await transaction
        .selectFrom('scoring_rule_changes')
        .selectAll()
        .where('id', '=', changeId)
        .forUpdate()
        .executeTakeFirst();
      if (!change) return null;
      if (change.status !== 'failed') throw new RuleChangeStateError('NOT_RETRYABLE', 'Only failed rule changes can be retried.');
      if (change.attempt_count >= change.max_attempts) throw new RuleChangeStateError('ATTEMPTS_EXHAUSTED', 'This rule change has exhausted its retry attempts.');
      const active = await transaction
        .selectFrom('scoring_rule_changes')
        .select('id')
        .where('rule_code', '=', change.rule_code)
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirst();
      if (active) throw new ActiveRuleChangeError(active.id);
      await transaction
        .updateTable('scoring_rule_changes')
        .set({
          status: 'queued',
          phase: 'queued',
          progress_percent: 0,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          cancellation_requested_at: null,
          next_attempt_at: new Date(),
          error_code: null,
          error_message: null,
          result_json: {},
          completed_at: null,
          updated_at: new Date(),
        })
        .where('id', '=', changeId)
        .execute();
      return this.getByIdUsing(transaction, changeId).then(requireChange);
    });
  }

  async recoverStale(limit = 100): Promise<{ requeued: number; failed: number; cancelled: number }> {
    return this.db.transaction().execute(async (transaction) => {
      const stale = await transaction
        .selectFrom('scoring_rule_changes')
        .select(['id', 'attempt_count', 'max_attempts', 'cancellation_requested_at'])
        .where('status', '=', 'running')
        .where('lease_expires_at', '<', new Date())
        .orderBy('lease_expires_at', 'asc')
        .limit(clampInteger(limit, 1, 1000))
        .forUpdate()
        .skipLocked()
        .execute();
      const counts = { requeued: 0, failed: 0, cancelled: 0 };
      for (const change of stale) {
        if (change.cancellation_requested_at !== null) {
          await transaction
            .updateTable('scoring_rule_changes')
            .set(terminalValues('cancelled', null, null))
            .where('id', '=', change.id)
            .execute();
          counts.cancelled += 1;
        } else if (change.attempt_count >= change.max_attempts) {
          await transaction
            .updateTable('scoring_rule_changes')
            .set(terminalValues('failed', 'STALE_LEASE', 'Worker lease expired after the final attempt.'))
            .where('id', '=', change.id)
            .execute();
          counts.failed += 1;
        } else {
          await transaction
            .updateTable('scoring_rule_changes')
            .set({
              status: 'queued',
              phase: 'recovered',
              lease_owner: null,
              lease_expires_at: null,
              heartbeat_at: null,
              next_attempt_at: new Date(),
              updated_at: new Date(),
              error_code: 'STALE_LEASE_RECOVERED',
              error_message: 'The previous worker lease expired; the change was safely requeued.',
            })
            .where('id', '=', change.id)
            .execute();
          counts.requeued += 1;
        }
      }
      return counts;
    });
  }

  private async getByIdUsing(db: Kysely<Database>, changeId: string): Promise<RuleChangeReadModel | null> {
    const row = await db
      .selectFrom('scoring_rule_changes')
      .selectAll()
      .where('id', '=', changeId)
      .executeTakeFirst();
    return row ? toRuleChange(row) : null;
  }
}

export class RuleChangeCancelledError extends Error {
  constructor() {
    super('Rule change cancellation was requested.');
    this.name = 'RuleChangeCancelledError';
  }
}

function toRuleVersion(row: ScoringRuleRow): RuleVersionReadModel {
  return {
    id: row.id,
    version: requiredNumber(row.version),
    supersedesRuleId: row.supersedes_rule_id,
    code: row.code,
    name: row.name,
    activityType: row.activity_type,
    ruleKind: row.rule_kind,
    metric: row.metric,
    coefficient: optionalNumber(row.coefficient),
    thresholdOperator: row.threshold_operator ?? undefined,
    thresholdValue: optionalNumber(row.threshold_value),
    thresholdUnit: row.threshold_unit ?? undefined,
    points: optionalNumber(row.points),
    validFrom: dateString(row.valid_from),
    validTo: row.valid_to === null ? undefined : dateString(row.valid_to),
    priority: requiredNumber(row.priority),
    enabled: row.enabled,
    description: row.description ?? undefined,
    createdAt: isoTimestamp(row.created_at),
  };
}

function toRuleChange(row: ScoringRuleChange): RuleChangeReadModel {
  return {
    id: row.id,
    ruleCode: row.rule_code,
    previousRuleId: row.previous_rule_id,
    proposedRuleId: row.proposed_rule_id,
    status: row.status,
    phase: row.phase,
    progressPercent: requiredNumber(row.progress_percent),
    attemptCount: requiredNumber(row.attempt_count),
    maxAttempts: requiredNumber(row.max_attempts),
    cancellationRequested: row.cancellation_requested_at !== null,
    initiatedBy: row.initiated_by,
    reason: row.reason,
    proposal: row.proposal_json as unknown as RuleProposal,
    preview: row.preview_json as unknown as RuleChangePreview,
    previewFingerprint: row.preview_fingerprint,
    affectedFrom: dateString(row.affected_from),
    affectedTo: dateString(row.affected_to),
    error: row.error_code && row.error_message ? { code: row.error_code, message: row.error_message } : null,
    result: row.result_json,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
    startedAt: nullableTimestamp(row.started_at),
    completedAt: nullableTimestamp(row.completed_at),
  };
}

function toActivityFact(row: Database['activities']): ActivityFact {
  return {
    id: row.id,
    activityDate: dateString(row.activity_date),
    activityType: row.activity_type,
    subtype: row.subtype ?? undefined,
    distanceM: optionalNumber(row.distance_m),
    durationS: optionalNumber(row.duration_s),
    steps: optionalNumber(row.steps),
    avgSpeedMps: optionalNumber(row.avg_speed_mps),
    effortPoints: optionalNumber(row.effort_points),
    source: row.source,
  };
}

function terminalValues(status: 'failed' | 'cancelled', code: string | null, message: string | null) {
  return {
    status,
    phase: status,
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: new Date(),
    completed_at: new Date(),
    updated_at: new Date(),
    error_code: code,
    error_message: message,
  } as const;
}

function requireChange(change: RuleChangeReadModel | null): RuleChangeReadModel {
  if (!change) throw new Error('Rule change disappeared during transaction.');
  return change;
}

function jsonb(value: unknown) {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}

function previousDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function safeCode(value: string): string {
  return value.replace(/[^A-Z0-9_]+/gi, '_').toUpperCase().slice(0, 120) || 'RULE_CHANGE_FAILED';
}

function safeText(value: string, maximum: number, fallback: string): string {
  const sanitized = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return (sanitized || fallback).slice(0, maximum);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(?:[A-Za-z]:\\|\/)[^\s"']+/g, '[redacted-path]')
    .replace(/(?:password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredNumber(value);
}

function requiredNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Invalid numeric database value.');
  return parsed;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new Error('Invalid database date value.');
}

function isoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error('Invalid database timestamp value.');
  return date.toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : isoTimestamp(value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
