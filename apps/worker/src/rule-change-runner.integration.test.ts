import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RuleChangePreview, RuleProposal } from '@sportos/domain';
import {
  createDb,
  LEGACY_ACCOUNT_ID,
  RuleChangesRepository,
  withAccountContext,
} from '@sportos/db';
import { RuleChangeRunner } from './rule-change-runner.js';

const dispatchDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const dataDatabaseUrl = process.env.SPORTOS_WORKER_DATA_DATABASE_URL;
const databaseDescribe = dispatchDatabaseUrl && dataDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

const metricDate = '2026-05-18';
const ruleCode = 'run.km.default';

databaseDescribe('RuleChangeRunner database integration', () => {
  let dispatchDb: TestDatabase;
  let dataDb: TestDatabase;

  beforeAll(() => {
    dispatchDb = createDb(requireDatabaseUrl(dispatchDatabaseUrl, 'SPORTOS_TEST_DATABASE_URL'));
    dataDb = createDb(requireDatabaseUrl(dataDatabaseUrl, 'SPORTOS_WORKER_DATA_DATABASE_URL'));
  });

  beforeEach(async () => {
    await reset(dataDb);
    await withAccountContext(dataDb, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      await ownerDb.insertInto('daily_metrics').values({
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
      }).execute();
    });
  });

  afterAll(async () => {
    if (dataDb) await reset(dataDb);
    await Promise.all([dispatchDb?.destroy(), dataDb?.destroy()]);
  });

  it('dispatches globally but recomputes only inside the claimed owner context', async () => {
    const queued = await withAccountContext(dataDb, LEGACY_ACCOUNT_ID, async (ownerDb) => {
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

    const runner = new RuleChangeRunner(dispatchDb, dataDb, {
      workerId: 'rule-worker-test',
      leaseSeconds: 60,
      pollIntervalMs: 100,
    });
    await expect(runner.processNext()).resolves.toBe(true);
    await expect(runner.processNext()).resolves.toBe(false);

    const evidence = await withAccountContext(dataDb, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      const change = await new RuleChangesRepository(ownerDb).getById(queued.id);
      const daily = await ownerDb
        .selectFrom('daily_metrics')
        .select(['total_points', 'owner_id'])
        .where('metric_date', '=', metricDate)
        .executeTakeFirstOrThrow();
      const ledger = await ownerDb
        .selectFrom('score_ledger')
        .select(['rule_id', 'points', 'owner_id'])
        .where('metric_date', '=', metricDate)
        .where('rule_id', '=', queued.proposedRuleId)
        .executeTakeFirstOrThrow();
      return { change, daily, ledger };
    });

    expect(evidence.change).toMatchObject({
      status: 'succeeded',
      phase: 'completed',
      progressPercent: 100,
      attemptCount: 1,
      result: { datesRecomputed: 1, proposedRuleId: queued.proposedRuleId },
    });
    expect(Number(evidence.daily.total_points)).toBe(2750);
    expect(evidence.daily.owner_id).toBe(LEGACY_ACCOUNT_ID);
    expect(evidence.ledger).toMatchObject({
      rule_id: queued.proposedRuleId,
      points: 2750,
      owner_id: LEGACY_ACCOUNT_ID,
    });

    expect(await dispatchDb.selectFrom('scoring_rules').select('id').execute()).toEqual([]);
    expect(await dispatchDb.selectFrom('daily_metrics').select('metric_date').execute()).toEqual([]);
    expect(await dispatchDb.selectFrom('score_ledger').select('id').execute()).toEqual([]);
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
  await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
    await ownerDb.deleteFrom('scoring_rule_changes').where('rule_code', '=', ruleCode).execute();
    await ownerDb.deleteFrom('score_ledger').where('metric_date', '=', metricDate).execute();
    await ownerDb.deleteFrom('daily_metrics').where('metric_date', '=', metricDate).execute();
    await ownerDb.deleteFrom('scoring_rules').where('code', '=', ruleCode).where('version', '>', 1).execute();
    await ownerDb.updateTable('scoring_rules')
      .set({ valid_to: null, enabled: true, supersedes_rule_id: null })
      .where('code', '=', ruleCode)
      .where('version', '=', 1)
      .execute();
  });
}

function requireDatabaseUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for database integration tests.`);
  const databaseName = new URL(value).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) {
    throw new Error(`${name} must target a database whose name ends in _test or -test.`);
  }
  return value;
}
