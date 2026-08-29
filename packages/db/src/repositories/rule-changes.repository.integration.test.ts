import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RuleChangePreview, RuleProposal } from '@sportos/domain';
import { createDb } from '../pool.js';
import { RuleChangesRepository, RuleOverlapError } from './rule-changes.repository.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

const metricDate = '2026-05-18';
const ruleCode = 'run.km.default';

databaseDescribe('RuleChangesRepository database integration', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = createDb(requireTestDatabaseUrl());
  });

  beforeEach(async () => {
    await resetRuleChangeState(db);
    await db
      .insertInto('daily_metrics')
      .values({
        metric_date: metricDate,
        source_record_id: null,
        steps: 0,
        run_m: 5000,
        bike_m: 0,
        swim_m: 0,
        workout_points: 0,
        power_points: 0,
        base_points: 5000,
        bonus_points: 0,
        total_points: 5000,
        excel_all_points: null,
        excel_row_hash: null,
      })
      .execute();
  });

  afterAll(async () => {
    if (db) {
      await resetRuleChangeState(db);
      await db.destroy();
    }
  });

  it('claims once and atomically activates a version, recomputes totals, and preserves historical rule identity', async () => {
    const repo = new RuleChangesRepository(db);
    const previous = await db
      .selectFrom('scoring_rules')
      .selectAll()
      .where('code', '=', ruleCode)
      .where('version', '=', 1)
      .executeTakeFirstOrThrow();
    const proposal = replacementProposal(previous.id);
    const queued = await repo.enqueueChange({
      proposal,
      preview: preview(),
      previewFingerprint: 'a'.repeat(64),
      initiatedBy: 'integration-test',
      reason: 'Increase the run coefficient with explicit evidence.',
    });

    const claimed = await repo.claimNext('worker-a', 60);
    const duplicate = await repo.claimNext('worker-b', 60);
    expect(claimed).toMatchObject({ id: queued.id, previousRuleId: previous.id, attemptCount: 1 });
    expect(duplicate).toBeNull();

    await repo.heartbeat(queued.id, 'worker-a', 'recomputing-scores', 50, 60);
    const result = await repo.activateAndRecompute(queued.id, 'worker-a');
    expect(result).toMatchObject({ datesRecomputed: 1, proposedRuleId: queued.proposedRuleId });

    const historical = await db
      .selectFrom('scoring_rules')
      .select(['id', 'version', 'valid_from', 'valid_to', 'enabled'])
      .where('id', '=', previous.id)
      .executeTakeFirstOrThrow();
    const activated = await db
      .selectFrom('scoring_rules')
      .select(['id', 'version', 'supersedes_rule_id', 'enabled'])
      .where('id', '=', queued.proposedRuleId)
      .executeTakeFirstOrThrow();
    expect(normalizeDate(historical.valid_to)).toBe('2026-05-17');
    expect(historical).toMatchObject({ id: previous.id, version: 1, enabled: true });
    expect(activated).toMatchObject({ version: 2, supersedes_rule_id: previous.id, enabled: true });

    const daily = await db
      .selectFrom('daily_metrics')
      .select(['base_points', 'bonus_points', 'total_points'])
      .where('metric_date', '=', metricDate)
      .executeTakeFirstOrThrow();
    expect(Number(daily.base_points)).toBe(6000);
    expect(Number(daily.bonus_points)).toBe(0);
    expect(Number(daily.total_points)).toBe(6000);

    const ledger = await db
      .selectFrom('score_ledger')
      .select(['rule_id', 'points'])
      .where('metric_date', '=', metricDate)
      .where('rule_id', '=', queued.proposedRuleId)
      .executeTakeFirstOrThrow();
    expect(ledger).toMatchObject({ rule_id: queued.proposedRuleId, points: 6000 });
    expect(await repo.getById(queued.id)).toMatchObject({
      status: 'succeeded',
      phase: 'completed',
      progressPercent: 100,
      result: { datesRecomputed: 1, proposedRuleId: queued.proposedRuleId },
    });
  });

  it('rejects an overlapping active definition and recovers stale leases without changing authoritative rules', async () => {
    const repo = new RuleChangesRepository(db);
    const previous = await db
      .selectFrom('scoring_rules')
      .selectAll()
      .where('code', '=', ruleCode)
      .where('version', '=', 1)
      .executeTakeFirstOrThrow();

    await expect(repo.enqueueChange({
      proposal: { ...replacementProposal(previous.id), replaceRuleId: undefined },
      preview: preview(),
      previewFingerprint: 'b'.repeat(64),
      initiatedBy: 'integration-test',
      reason: 'This intentionally overlaps the existing active range.',
    })).rejects.toBeInstanceOf(RuleOverlapError);

    const queued = await repo.enqueueChange({
      proposal: replacementProposal(previous.id),
      preview: preview(),
      previewFingerprint: 'c'.repeat(64),
      initiatedBy: 'integration-test',
      reason: 'Exercise stale recovery.',
    });
    await repo.claimNext('lost-worker', 60);
    await db
      .updateTable('scoring_rule_changes')
      .set({ lease_expires_at: new Date(Date.now() - 60_000) })
      .where('id', '=', queued.id)
      .execute();

    await expect(repo.recoverStale()).resolves.toEqual({ requeued: 1, failed: 0, cancelled: 0 });
    expect(await repo.getById(queued.id)).toMatchObject({ status: 'queued', phase: 'recovered', attemptCount: 1 });
    const proposed = await db
      .selectFrom('scoring_rules')
      .select(['enabled'])
      .where('id', '=', queued.proposedRuleId)
      .executeTakeFirstOrThrow();
    expect(proposed.enabled).toBe(false);
    const current = await db
      .selectFrom('daily_metrics')
      .select('total_points')
      .where('metric_date', '=', metricDate)
      .executeTakeFirstOrThrow();
    expect(Number(current.total_points)).toBe(5000);
  });

  it('does not overwrite an imported ledger when a rule version is activated', async () => {
    await db
      .updateTable('daily_metrics')
      .set({
        score_status: 'imported',
        base_points: 5000,
        bonus_points: 0,
        total_points: 5000,
        excel_all_points: 5000,
      })
      .where('metric_date', '=', metricDate)
      .execute();
    await db.insertInto('score_ledger').values({
      metric_date: metricDate,
      activity_id: null,
      rule_id: null,
      points: 5000,
      reason: 'Imported workbook ledger total',
      calculation_json: { scoreStatus: 'imported', source: 'my_sport_xlsx', field: 'All', importedPoints: 5000 },
    }).execute();

    const repo = new RuleChangesRepository(db);
    const previous = await db
      .selectFrom('scoring_rules')
      .selectAll()
      .where('code', '=', ruleCode)
      .where('version', '=', 1)
      .executeTakeFirstOrThrow();
    const queued = await repo.enqueueChange({
      proposal: replacementProposal(previous.id),
      preview: preview(),
      previewFingerprint: 'e'.repeat(64),
      initiatedBy: 'integration-test',
      reason: 'Imported ledgers require explicit recalculation first.',
    });

    await repo.claimNext('worker-imported', 60);
    const result = await repo.activateAndRecompute(queued.id, 'worker-imported');
    expect(result).toMatchObject({ datesRecomputed: 0, datesSkippedImported: 1 });

    const daily = await db.selectFrom('daily_metrics').select(['score_status', 'total_points']).where('metric_date', '=', metricDate).executeTakeFirstOrThrow();
    const ledger = await db.selectFrom('score_ledger').select(['rule_id', 'points', 'reason']).where('metric_date', '=', metricDate).executeTakeFirstOrThrow();
    expect(daily).toMatchObject({ score_status: 'imported', total_points: 5000 });
    expect(ledger).toMatchObject({ rule_id: null, points: 5000, reason: 'Imported workbook ledger total' });
  });
});

function replacementProposal(previousRuleId: string): RuleProposal {
  return {
    replaceRuleId: previousRuleId,
    code: ruleCode,
    name: 'Run: km coefficient v2',
    activityType: 'run',
    ruleKind: 'coefficient',
    metric: 'distance_km',
    coefficient: 1200,
    validFrom: metricDate,
    priority: 20,
    description: 'Integration-test rule version.',
  };
}

function preview(): RuleChangePreview {
  return {
    affectedFrom: metricDate,
    affectedTo: metricDate,
    totalDates: 1,
    changedDates: 1,
    aggregateDelta: 1000,
    minimumDelta: 1000,
    maximumDelta: 1000,
    rows: [{
      metricDate,
      currentBasePoints: 5000,
      proposedBasePoints: 6000,
      currentBonusPoints: 0,
      proposedBonusPoints: 0,
      currentTotalPoints: 5000,
      proposedTotalPoints: 6000,
      delta: 1000,
    }],
  };
}

async function resetRuleChangeState(db: TestDatabase): Promise<void> {
  await db.deleteFrom('scoring_rule_changes').where('rule_code', '=', ruleCode).execute();
  await db.deleteFrom('score_ledger').where('metric_date', '=', metricDate).execute();
  await db.deleteFrom('daily_metrics').where('metric_date', '=', metricDate).execute();
  await db.deleteFrom('scoring_rules').where('code', '=', ruleCode).where('version', '>', 1).execute();
  await db
    .updateTable('scoring_rules')
    .set({ valid_to: null, enabled: true, supersedes_rule_id: null })
    .where('code', '=', ruleCode)
    .where('version', '=', 1)
    .execute();
}

function normalizeDate(value: unknown): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) throw new Error('SPORTOS_TEST_DATABASE_URL is required for database integration tests.');
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) {
    throw new Error('SPORTOS_TEST_DATABASE_URL must target a database whose name ends in _test or -test.');
  }
  return testDatabaseUrl;
}
