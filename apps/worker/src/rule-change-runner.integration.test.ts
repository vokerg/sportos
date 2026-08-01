import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RuleChangePreview, RuleProposal } from '@sportos/domain';
import {
  createDb,
  LEGACY_ACCOUNT_ID,
  RuleChangesRepository,
  withAccountContext,
} from '@sportos/db';
import { RuleChangeRunner } from './rule-change-runner.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

const metricDate = '2026-05-18';
const ruleCode = 'run.km.default';

databaseDescribe('RuleChangeRunner database integration', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = createDb(requireTestDatabaseUrl());
  });

  beforeEach(async () => {
    await reset(db);
    await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      await ownerDb
        .insertInto('daily_metrics')
        .values({
          metric_date: metricDate,
          source_record_id: null,
          steps: 0,
          run_m: 2500,
          bike_m: 0,
          swim_m: 0,
          workout_points: 0,
          power_points: 0,
          base_points: 2500,
          bonus_points: 0,
          total_points: 2500,
          excel_all_points: null,
          excel_row_hash: null,
        })
        .execute();
    });
  });

  afterAll(async () => {
    if (db) {
      await reset(db);
      await db.destroy();
    }
  });

  it('claims and completes a queued audited recomputation without the API process', async () => {
    const queued = await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      const previous = await ownerDb
        .selectFrom('scoring_rules')
        .select('id')
        .where('code', '=', ruleCode)
        .where('version', '=', 1)
        .executeTakeFirstOrThrow();
      return new RuleChangesRepository(ownerDb).enqueueChange({
        proposal: proposal(previous.id),
        preview: preview(),
        previewFingerprint: 'd'.repeat(64),
        initiatedBy: LEGACY_ACCOUNT_ID,
        reason: 'Verify independent worker execution.',
      });
    });

    const changes = new RuleChangesRepository(db);
    const runner = new RuleChangeRunner(db, { workerId: 'rule-worker-test', leaseSeconds: 60, pollIntervalMs: 100 });
    await expect(runner.processNext()).resolves.toBe(true);
    await expect(runner.processNext()).resolves.toBe(false);

    expect(await changes.getById(queued.id)).toMatchObject({
      status: 'succeeded',
      phase: 'completed',
      progressPercent: 100,
      attemptCount: 1,
      result: { datesRecomputed: 1, proposedRuleId: queued.proposedRuleId },
    });
    const daily = await db
      .selectFrom('daily_metrics')
      .select(['total_points', 'owner_id'])
      .where('metric_date', '=', metricDate)
      .executeTakeFirstOrThrow();
    expect(Number(daily.total_points)).toBe(2750);
    expect(daily.owner_id).toBe(LEGACY_ACCOUNT_ID);
    const ledger = await db
      .selectFrom('score_ledger')
      .select(['rule_id', 'points', 'owner_id'])
      .where('metric_date', '=', metricDate)
      .where('rule_id', '=', queued.proposedRuleId)
      .executeTakeFirstOrThrow();
    expect(ledger).toMatchObject({ rule_id: queued.proposedRuleId, points: 2750, owner_id: LEGACY_ACCOUNT_ID });
  });
});

function proposal(previousRuleId: string): RuleProposal {
  return {
    replaceRuleId: previousRuleId,
    code: ruleCode,
    name: 'Run: worker integration coefficient',
    activityType: 'run',
    ruleKind: 'coefficient',
    metric: 'distance_km',
    coefficient: 1100,
    validFrom: metricDate,
    priority: 20,
    description: 'Worker integration version.',
  };
}

function preview(): RuleChangePreview {
  return {
    affectedFrom: metricDate,
    affectedTo: metricDate,
    totalDates: 1,
    changedDates: 1,
    aggregateDelta: 250,
    minimumDelta: 250,
    maximumDelta: 250,
    rows: [{
      metricDate,
      currentBasePoints: 2500,
      proposedBasePoints: 2750,
      currentBonusPoints: 0,
      proposedBonusPoints: 0,
      currentTotalPoints: 2500,
      proposedTotalPoints: 2750,
      delta: 250,
    }],
  };
}

async function reset(db: TestDatabase): Promise<void> {
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

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) throw new Error('SPORTOS_TEST_DATABASE_URL is required for database integration tests.');
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) {
    throw new Error('SPORTOS_TEST_DATABASE_URL must target a database whose name ends in _test or -test.');
  }
  return testDatabaseUrl;
}
