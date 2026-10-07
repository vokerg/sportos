import { GarminDayRepository } from './garmin-day.repository.js';
import { lockActivityReconciliation } from './garmin-activities.repository.js';
import { GarminStrengthRepository } from './garmin-strength.repository.js';
import { resolveDailyWorkout } from './daily-workout-resolution.js';
import { createHash } from 'node:crypto';
import { aggregateActivitiesToDailyFacts, deductRunningSteps, normalizeStravaRunCadenceSpm, scoreDay, type ActivityFact } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Activity, DailyMetric, Database, Json } from '../schema.js';
import type { DailyMetricFactsInput, DailyStepsCalculation, DailyWorkoutCalculation, ManualDailyFactsInput } from '../repository-contracts.js';
import { DailyRepository, type ScoringActivityRow } from './daily.repository.js';
import { ImportsRepository } from './imports.repository.js';
import { ScoringRepository } from './scoring.repository.js';

export class DailyRecalculationUnavailableError extends Error {
  readonly code = 'STRAVA_DATA_UNAVAILABLE' as const;

  constructor(readonly metricDate: string) {
    super(`No Strava activity is available for ${metricDate}.`);
    this.name = 'DailyRecalculationUnavailableError';
  }
}

export class DailyScoringRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async runningStepEstimate(metricDate: string) {
    const rows = await new DailyRepository(this.db).listActivitiesForDates([metricDate]);
    const deduction = deductRunningSteps(0, rows.filter((row) => row.source === 'strava').map(toActivityFact));
    return {
      estimatedRunningSteps: deduction.estimatedRunningSteps,
      unestimatedRunCount: deduction.unestimatedRunCount,
    };
  }

  async saveManualFacts(metricDate: string, input: ManualDailyFactsInput) {
    return this.db.transaction().execute(async (transaction) => {
      await lockDailyScore(transaction, metricDate);

      const runUnspecifiedM = input.runUnspecifiedM ?? 0;
      const bikeUnspecifiedM = input.bikeUnspecifiedM ?? 0;

      const existing = await transaction
        .selectFrom('daily_metrics')
        .selectAll()
        .where('metric_date', '=', metricDate)
        .forUpdate()
        .executeTakeFirst();
      const deduction = input.totalSteps === undefined ? null : deductRunningSteps(
        input.totalSteps,
        (await new DailyRepository(transaction).listActivitiesForDates([metricDate]))
          .filter((row) => row.source === 'strava').map(toActivityFact),
      );
      const resolvedSteps = deduction?.nonRunningSteps ?? input.steps;
      const facts: DailyMetricFactsInput = {
        metricDate,
        ...input,
        steps: resolvedSteps,
        runM: input.runIndoorM + input.runOutdoorM + runUnspecifiedM,
        bikeM: input.bikeIndoorM + input.bikeOutdoorM + bikeUnspecifiedM,
        bonusPoints: input.bonusPoints,
        stepsCalculation: {
          source: deduction ? 'manual_adjusted' : resolvedSteps > 0 ? 'manual' : 'none',
          resolvedSteps,
          ...(deduction ? {
            totalSteps: deduction.garminTotalSteps,
            estimatedRunningSteps: deduction.estimatedRunningSteps,
            runs: deduction.runs,
            unestimatedRunCount: deduction.unestimatedRunCount,
          } : {}),
        },
        workoutCalculation: { source: input.workoutPoints > 0 ? 'manual' : 'none', resolvedPoints: input.workoutPoints },
        excelAllPoints: optionalNumber(existing?.excel_all_points),
        excelRowHash: existing?.excel_row_hash ?? undefined,
      };
      const score = attachWorkoutCalculation(attachStepsCalculation(scoreDay(
        { ...facts, excelAllPoints: undefined, excelRowHash: undefined },
        [],
        await new ScoringRepository(transaction).listEnabledRules(),
      ), facts.stepsCalculation!), facts.workoutCalculation!);

      const rawJson: Json = { metricDate, facts: { ...input } };
      const rowHash = createHash('sha256').update(JSON.stringify(rawJson)).digest('hex');
      const importsRepository = new ImportsRepository(transaction);
      const batch = await importsRepository.createBatch({
        source: 'manual_daily_edit',
        sourceKind: 'manual',
        metadata: { action: 'daily-facts-edit' },
      });
      const sourceRecord = (await importsRepository.insertSourceRecords([{
        import_batch_id: batch.id,
        source: 'manual_daily_edit',
        sheet_name: null,
        row_index: null,
        source_record_key: `daily:${metricDate}`,
        row_hash: rowHash,
        raw_json: rawJson,
        normalized_entity_type: null,
        normalized_entity_id: null,
        status: 'raw',
        errors: [],
        warnings: [],
      }]))[0];
      if (!sourceRecord) throw new Error(`Manual source record was not created for ${metricDate}.`);

      await transaction.deleteFrom('activities')
        .where('activity_date', '=', metricDate)
        .where('source', '=', 'manual')
        .execute();
      const dailyRepository = new DailyRepository(transaction);
      await dailyRepository.upsertActivities(manualActivities(metricDate, { ...input, steps: resolvedSteps, runUnspecifiedM, bikeUnspecifiedM }, sourceRecord.id, rowHash));
      await dailyRepository.persistDailyScore(
        facts,
        score,
        sourceRecord.id,
        { scoreStatus: 'manual', trigger: 'manual_edit' },
      );
      await importsRepository.markRecordsNormalized([{
        sourceRecordId: sourceRecord.id,
        entityType: 'daily_metric',
        entityId: metricDate,
      }]);
      await importsRepository.setAffectedDates(batch.id, [metricDate]);
      await importsRepository.updateBatchCounts(batch.id, {
        row_count: 1,
        normalized_count: 1,
        status: 'scored',
      }, 'manual-daily-facts-saved');

      const result = await dailyRepository.getDailyScoreBreakdown(metricDate);
      if (!result) throw new Error(`Daily score disappeared while saving manual facts for ${metricDate}.`);
      return result;
    });
  }

  async recalculateFromActivities(metricDate: string) {
    return this.db.transaction().execute(async (transaction) => {
      await lockActivityReconciliation(transaction);
      await lockDailyScore(transaction, metricDate);

      const daily = await transaction
        .selectFrom('daily_metrics')
        .selectAll()
        .where('metric_date', '=', metricDate)
        .forUpdate()
        .executeTakeFirst();
      const dailyRepository = new DailyRepository(transaction);
      const activityRows = await dailyRepository.listActivitiesForDates([metricDate]);
      const activities = activityRows.map(toActivityFact);
      const sourceActivities = activities.filter((activity) => activity.source !== 'manual');
      const manualActivities = activities.filter((activity) => activity.source === 'manual');
      const stravaActivities = sourceActivities.filter((activity) => activity.source === 'strava');
      const csvEvidence = await dailyRepository.getGarminDailyStepEvidence(metricDate);
      const garminSteps = csvEvidence?.steps ?? null;
      const access = await sql<{ days: boolean; strength: boolean }>`select
        has_table_privilege(current_user, 'garmin_day_heads', 'SELECT') as days,
        has_table_privilege(current_user, 'garmin_strength_summaries', 'SELECT') as strength`.execute(transaction);
      const dayRows = access.rows[0]?.days ? await new GarminDayRepository(transaction).read(metricDate) : [];
      const connect = dayRows.find(row => row.category === 'summary' && row.availability === 'available');
      const connectValue = jsonRecord(connect?.projection_json).steps;
      const connectSteps = typeof connectValue === 'number' && Number.isSafeInteger(connectValue) && connectValue >= 0 ? connectValue : null;
      const snapshotFacts = daily?.score_snapshot_id
        ? (await transaction
          .selectFrom('daily_score_snapshots')
          .select('facts_json')
          .where('id', '=', daily.score_snapshot_id)
          .executeTakeFirst())?.facts_json ?? null
        : null;

      if (!daily && stravaActivities.length === 0 && garminSteps === null && connectSteps === null) {
        throw new DailyRecalculationUnavailableError(metricDate);
      }

      const scoringActivities = daily ? sourceActivities : stravaActivities;
      const baseFacts = daily
        ? factsFromDailyRow(daily, scoringActivities, manualActivities)
        : aggregateActivitiesToDailyFacts(metricDate, stravaActivities);
      const stepsCalculation = resolveDailySteps(
        daily,
        sourceActivities,
        manualActivities,
        stravaActivities,
        garminSteps,
        snapshotFacts,
        connectSteps === null || !connect ? undefined : { steps: connectSteps, sourceVersionId: connect.version_id!,
          retainedAt: connect.retrieved_at!.toISOString(), latestAttemptAt: connect.attempted_at.toISOString(), latestAttemptState: connect.state },
      );
      if (stepsCalculation.garminSource === 'csv' && csvEvidence) {
        stepsCalculation.garminObservationId = csvEvidence.garminObservationId;
        stepsCalculation.sourceRecordId = csvEvidence.sourceRecordId;
        stepsCalculation.retainedAt = csvEvidence.retainedAt;
      }
      const summaries = access.rows[0]?.strength ? await new GarminStrengthRepository(transaction).forDate(metricDate) : [];
      const discovery = dayRows.find(row => row.category === 'activities');
      const projection = jsonRecord(discovery?.projection_json);
      const failures = jsonRecord(discovery?.attempt_json).failures;
      let incompleteReason: string | undefined;
      if (discovery && (discovery.state !== 'available' || projection.complete !== true || (Array.isArray(failures) && failures.length))) {
        incompleteReason = 'Garmin activity discovery or extraction is incomplete; previous workout points were preserved.';
      }
      if (Array.isArray(projection.identities) && projection.identities.length) {
        const ids = projection.identities.filter((item): item is string => typeof item === 'string');
        const discovered = await transaction.selectFrom('garmin_activity_identities').select(['identity_key','activity_type','activity_id'])
          .where('identity_key', 'in', ids).limit(21).execute();
        if (discovered.length !== ids.length || discovered.some(item => item.activity_type === 'workout' &&
          (!item.activity_id || !summaries.some(summary => summary.activityId === item.activity_id)))) {
          incompleteReason = 'A discovered Garmin activity is unlinked or lacks current strength evidence; previous workout points were preserved.';
        }
      }
      const recordedWorkouts = sourceActivities.filter(item => item.activityType === 'workout' && (item.source === 'strava' || item.durationS !== undefined || item.movingTimeS !== undefined));
      if (summaries.length > 20 || recordedWorkouts.some(item => !summaries.some(summary => summary.activityId === item.id))) {
        incompleteReason = 'Not every recorded workout has complete linked Garmin strength evidence; previous workout points were preserved.';
      }
      const workoutCalculation = resolveDailyWorkout(baseFacts.workoutPoints, manualActivities,
        daily?.score_status === 'imported', summaries.slice(0,20).map(row => ({ activityId: row.activityId,
          identityId: row.identityId, workingSets: row.working_sets, complete: row.complete,
          sourceVersionId: row.version_id, sourceUpdatedAt: row.source_updated_at.toISOString(), derivedAt: row.derived_at.toISOString() })), incompleteReason);
      const facts: DailyMetricFactsInput = {
        ...baseFacts,
        steps: stepsCalculation.resolvedSteps,
        stepsCalculation,
        workoutPoints: workoutCalculation.resolvedPoints,
        workoutCalculation,
      };
      const score = attachWorkoutCalculation(attachStepsCalculation(scoreDay(
        { ...facts, excelAllPoints: undefined, excelRowHash: undefined },
        scoringActivities,
        await new ScoringRepository(transaction).listEnabledRules(),
      ), stepsCalculation), workoutCalculation);

      await dailyRepository.persistDailyScore(
        facts,
        score,
        daily?.source_record_id ?? undefined,
        { scoreStatus: 'calculated', trigger: 'manual_recalculation' },
      );

      const result = await dailyRepository.getDailyScoreBreakdown(metricDate);
      if (!result) throw new Error(`Daily score disappeared while recalculating ${metricDate}.`);
      return result;
    });
  }
}

async function lockDailyScore(db: Kysely<Database>, metricDate: string): Promise<void> {
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        'sportos.daily.score-write:' || sportos_current_account_id()::text || ':' || ${metricDate},
        0
      )
    )
  `.execute(db);
}

function manualActivities(
  metricDate: string,
  input: ManualDailyFactsInput,
  sourceRecordId: string,
  rowHash: string,
) {
  const rows: Array<{
    activityType: Activity['activity_type'];
    subtype: Activity['subtype'];
    distanceM?: number;
    steps?: number;
    effortPoints?: number;
  }> = [];
  if (input.steps > 0) rows.push({ activityType: 'steps', subtype: 'manual', steps: input.steps });
  appendDistance(rows, 'run', 'treadmill', input.runIndoorM);
  appendDistance(rows, 'run', 'outdoor', input.runOutdoorM);
  appendDistance(rows, 'run', 'unknown', input.runUnspecifiedM ?? 0);
  appendDistance(rows, 'bike', 'indoor', input.bikeIndoorM);
  appendDistance(rows, 'bike', 'outdoor', input.bikeOutdoorM);
  appendDistance(rows, 'bike', 'unknown', input.bikeUnspecifiedM ?? 0);
  appendDistance(rows, 'swim', 'manual', input.swimM);
  if (input.workoutPoints > 0) rows.push({ activityType: 'workout', subtype: 'manual', effortPoints: input.workoutPoints });
  if (input.bonusPoints > 0) rows.push({ activityType: 'bonus', subtype: 'manual', effortPoints: input.bonusPoints });

  return rows.map((row, index) => ({
    source: 'manual' as const,
    source_record_id: sourceRecordId,
    source_activity_id: `${metricDate}:${index + 1}`,
    source_record_hash: `${rowHash}:${index + 1}`,
    activity_date: metricDate,
    start_time: null,
    activity_type: row.activityType,
    subtype: row.subtype,
    distance_m: row.distanceM ?? null,
    duration_s: null,
    moving_time_s: null,
    steps: row.steps ?? null,
    calories: null,
    avg_hr: null,
    max_hr: null,
    elevation_gain_m: null,
    avg_speed_mps: null,
    avg_pace_s_per_km: null,
    effort_points: row.effortPoints ?? null,
    notes: null,
    raw_payload_json: { manualDailyFacts: true },
  }));
}

function appendDistance(
  rows: Array<{ activityType: Activity['activity_type']; subtype: Activity['subtype']; distanceM?: number }>,
  activityType: 'run' | 'bike' | 'swim',
  subtype: NonNullable<Activity['subtype']>,
  distanceM: number,
): void {
  if (distanceM > 0) rows.push({ activityType, subtype, distanceM });
}

function factsFromDailyRow(
  row: DailyMetric,
  sourceActivities: ActivityFact[],
  manualActivities: ActivityFact[],
): DailyMetricFactsInput {
  const stored = {
    metricDate: dateString(row.metric_date),
    steps: number(row.steps),
    runM: number(row.run_m),
    bikeM: number(row.bike_m),
    swimM: number(row.swim_m),
    workoutPoints: number(row.workout_points),
    excelAllPoints: optionalNumber(row.excel_all_points),
    excelRowHash: row.excel_row_hash ?? undefined,
  };

  const source = aggregateActivitiesToDailyFacts(stored.metricDate, sourceActivities, stored.excelAllPoints);
  const manual = aggregateActivitiesToDailyFacts(stored.metricDate, manualActivities, stored.excelAllPoints);
  const run = distanceFacts('run', stored.runM, sourceActivities, source, manualActivities, manual);
  const bike = distanceFacts('bike', stored.bikeM, sourceActivities, source, manualActivities, manual);
  const swimM = hasActivityType(sourceActivities, 'swim')
    ? source.swimM
    : hasActivityType(manualActivities, 'swim') ? manual.swimM : stored.swimM;

  return {
    metricDate: stored.metricDate,
    // Strava does not provide these workbook/manual facts. Recalculation must
    // refresh supported activity measurements without erasing them.
    steps: stored.steps,
    ...run,
    ...bike,
    swimM,
    workoutPoints: stored.workoutPoints,
    // Recalculation is an explicit return to activity/rule authority. A prior
    // manual bonus override must not be retained or added to achievements.
    bonusPoints: 0,
    excelAllPoints: stored.excelAllPoints,
    excelRowHash: stored.excelRowHash,
  };
}

function distanceFacts(
  activityType: 'run',
  storedTotalM: number,
  sourceActivities: ActivityFact[],
  source: DailyMetricFactsInput,
  manualActivities: ActivityFact[],
  manual: DailyMetricFactsInput,
): Pick<DailyMetricFactsInput, 'runM' | 'runIndoorM' | 'runOutdoorM' | 'runUnspecifiedM'>;
function distanceFacts(
  activityType: 'bike',
  storedTotalM: number,
  sourceActivities: ActivityFact[],
  source: DailyMetricFactsInput,
  manualActivities: ActivityFact[],
  manual: DailyMetricFactsInput,
): Pick<DailyMetricFactsInput, 'bikeM' | 'bikeIndoorM' | 'bikeOutdoorM' | 'bikeUnspecifiedM'>;
function distanceFacts(
  activityType: 'run' | 'bike',
  storedTotalM: number,
  sourceActivities: ActivityFact[],
  source: DailyMetricFactsInput,
  manualActivities: ActivityFact[],
  manual: DailyMetricFactsInput,
): Pick<DailyMetricFactsInput, 'runM' | 'runIndoorM' | 'runOutdoorM' | 'runUnspecifiedM'>
  | Pick<DailyMetricFactsInput, 'bikeM' | 'bikeIndoorM' | 'bikeOutdoorM' | 'bikeUnspecifiedM'> {
  const selected = hasActivityType(sourceActivities, activityType)
    ? source
    : hasActivityType(manualActivities, activityType) ? manual : null;

  if (activityType === 'run') {
    return {
      runM: selected?.runM ?? storedTotalM,
      runIndoorM: selected?.runIndoorM,
      runOutdoorM: selected?.runOutdoorM,
      runUnspecifiedM: selected?.runUnspecifiedM,
    };
  }
  return {
    bikeM: selected?.bikeM ?? storedTotalM,
    bikeIndoorM: selected?.bikeIndoorM,
    bikeOutdoorM: selected?.bikeOutdoorM,
    bikeUnspecifiedM: selected?.bikeUnspecifiedM,
  };
}

function hasActivityType(activities: ActivityFact[], activityType: ActivityFact['activityType']): boolean {
  return activities.some((activity) => activity.activityType === activityType);
}

function toActivityFact(row: ScoringActivityRow): ActivityFact {
  return {
    id: row.id,
    activityDate: dateString(row.activity_date),
    activityType: row.activity_type,
    subtype: row.subtype ?? undefined,
    distanceM: optionalNumber(row.distance_m),
    durationS: optionalNumber(row.duration_s),
    movingTimeS: optionalNumber(row.moving_time_s),
    steps: optionalNumber(row.steps),
    avgSpeedMps: optionalNumber(row.avg_speed_mps),
    avgPaceSPerKm: optionalNumber(row.avg_pace_s_per_km),
    avgCadenceSpm: stravaRunCadenceSpm(row),
    effortPoints: optionalNumber(row.effort_points),
    source: row.source,
  };
}

export function resolveDailySteps(
  daily: Pick<DailyMetric, 'steps'> | undefined,
  sourceActivities: ActivityFact[],
  manualActivities: ActivityFact[],
  stravaActivities: ActivityFact[],
  garminSteps: number | null,
  snapshotFacts: Json | null,
  connect?: { steps: number; sourceVersionId: string; retainedAt: string; latestAttemptAt: string; latestAttemptState: string },
): DailyStepsCalculation {
  const previousSource = snapshotStepsSource(snapshotFacts);
  const manualSteps = activitySteps(manualActivities);
  if (manualSteps > 0) return { source: 'manual', resolvedSteps: manualSteps };

  const storedSteps = daily ? number(daily.steps) : 0;
  if (connect || garminSteps !== null) {
    const deduction = deductRunningSteps(connect?.steps ?? garminSteps!, stravaActivities);
    return {
      source: 'garmin_adjusted', garminSource: connect ? 'connect' : 'csv',
      ...(connect ? { sourceVersionId: connect.sourceVersionId, retainedAt: connect.retainedAt,
        latestAttemptAt: connect.latestAttemptAt, latestAttemptState: connect.latestAttemptState } : {}),
      resolvedSteps: deduction.nonRunningSteps,
      garminTotalSteps: deduction.garminTotalSteps,
      estimatedRunningSteps: deduction.estimatedRunningSteps,
      runs: deduction.runs,
      unestimatedRunCount: deduction.unestimatedRunCount,
    };
  }
  const importedSteps = activitySteps(sourceActivities.filter(activity => activity.source !== 'garmin' && activity.source !== 'strava'));
  if (importedSteps > 0 && previousSource !== 'none') return { source: 'imported', resolvedSteps: importedSteps };

  return { source: storedSteps > 0 ? 'stored' : 'none', resolvedSteps: storedSteps };
}

export function attachStepsCalculation<T extends { ledger: Array<{ ruleCode?: string; calculationJson: Record<string, unknown> }> }>(
  score: T,
  calculation: DailyStepsCalculation,
): T {
  return {
    ...score,
    ledger: score.ledger.map((entry) => entry.ruleCode === 'steps.base'
      ? { ...entry, calculationJson: { ...entry.calculationJson, stepsCalculation: calculation } }
      : entry),
  };
}

export function attachWorkoutCalculation<T extends { ledger: Array<{ calculationJson: Record<string, unknown> }> }>(
  score: T, calculation: DailyWorkoutCalculation,
): T {
  return { ...score, ledger: score.ledger.map(entry => entry.calculationJson.activityType === 'workout'
    && entry.calculationJson.classification === 'base'
    ? { ...entry, calculationJson: { ...entry.calculationJson, workoutCalculation: calculation } } : entry) };
}

function activitySteps(activities: ActivityFact[]): number {
  return Math.round(activities
    .filter((activity) => activity.activityType === 'steps')
    .reduce((sum, activity) => sum + (activity.steps ?? 0), 0));
}

function snapshotStepsSource(value: Json | null): DailyStepsCalculation['source'] | undefined {
  const facts = jsonRecord(value);
  const calculation = jsonRecord(facts.stepsCalculation);
  const source = calculation.source;
  return source === 'manual' || source === 'manual_adjusted' || source === 'imported' || source === 'garmin_adjusted' || source === 'stored' || source === 'none'
    ? source
    : undefined;
}

function stravaRunCadenceSpm(row: ScoringActivityRow): number | undefined {
  if (row.source !== 'strava' || row.activity_type !== 'run') return undefined;
  const value = jsonRecord(row.sourceRawJson).average_cadence;
  const cadence = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(cadence) || cadence <= 0) return undefined;

  return normalizeStravaRunCadenceSpm(cadence);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return number(value);
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Invalid numeric daily score input.');
  return parsed;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new Error('Invalid daily score date.');
}
