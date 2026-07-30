import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '@sportos/db';
import { ImportService, type ImportFailurePhase } from './import-service.js';
import { writeMySportFixture, writeRunDbFixture } from './test-fixtures/xlsx-fixtures.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('ImportService database integration', () => {
  let db: TestDatabase;
  let directory: string;
  let mySportPath: string;
  let runDbPath: string;

  beforeAll(async () => {
    db = createDb(requireTestDatabaseUrl());
    directory = mkdtempSync(join(tmpdir(), 'sportos-import-integration-'));
    mySportPath = join(directory, 'my-sport.xlsx');
    runDbPath = join(directory, 'running-performance.xlsx');
    writeMySportFixture(mySportPath);
    writeRunDbFixture(runDbPath);
    await resetImportTables(db);
  });

  afterAll(async () => {
    if (db) {
      await resetImportTables(db);
      await db.destroy();
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('converges on the same canonical state across identical imports', async () => {
    const service = new ImportService(db);

    const first = await service.importLocalFiles({ mySportPath, runDbPath });
    const firstCounts = await importCounts(db);
    const firstIds = await canonicalIds(db);
    const second = await service.importLocalFiles({ mySportPath, runDbPath });
    const secondCounts = await importCounts(db);
    const secondIds = await canonicalIds(db);

    expect(first).toMatchObject({ dailyRows: 2, activities: 13, performanceEvents: 7 });
    expect(second).toMatchObject({ dailyRows: 2, activities: 13, performanceEvents: 7 });
    expect(canonicalCounts(secondCounts)).toEqual(canonicalCounts(firstCounts));
    expect(secondIds).toEqual(firstIds);
    expect(secondCounts.importBatches).toBe(firstCounts.importBatches + 2);
    expect(secondCounts.sourceRecords).toBe(firstCounts.sourceRecords * 2);

    expect(secondCounts.activitiesWithoutSource).toBe(0);
    expect(secondCounts.dailyMetricsWithoutSource).toBe(0);
    expect(secondCounts.performanceEventsWithoutSource).toBe(0);

    const completedBatches = await db
      .selectFrom('import_batches')
      .select(['source', 'status', 'normalized_count'])
      .orderBy('started_at', 'asc')
      .execute();
    expect(completedBatches).toEqual([
      expect.objectContaining({ source: 'my_sport_xlsx', status: 'scored', normalized_count: 15 }),
      expect.objectContaining({ source: 'run_db_xlsx', status: 'normalized', normalized_count: 7 }),
      expect.objectContaining({ source: 'my_sport_xlsx', status: 'scored', normalized_count: 15 }),
      expect.objectContaining({ source: 'run_db_xlsx', status: 'normalized', normalized_count: 7 }),
    ]);

    const reconciledDay = await db
      .selectFrom('daily_metrics')
      .select(['base_points', 'bonus_points', 'total_points', 'excel_all_points'])
      .where('metric_date', '=', '2026-05-18')
      .executeTakeFirstOrThrow();
    expect(reconciledDay).toEqual({
      base_points: 55_603,
      bonus_points: 7,
      total_points: 55_610,
      excel_all_points: 55_610,
    });

    const powerLedger = await db
      .selectFrom('score_ledger as sl')
      .innerJoin('scoring_rules as sr', 'sr.id', 'sl.rule_id')
      .select(['sl.points', 'sl.calculation_json', 'sr.priority', 'sr.description'])
      .where('sl.metric_date', '=', '2026-05-18')
      .where('sr.code', '=', 'power.manual')
      .executeTakeFirstOrThrow();
    expect(powerLedger).toMatchObject({ points: 7, priority: 60 });
    expect(powerLedger.description).toContain('Bonus rule');
    expect(powerLedger.calculation_json).toMatchObject({
      classification: 'bonus',
      ruleKind: 'manual_points',
      activityType: 'power_bonus',
      rounding: 'nearest_integer_per_rule',
    });

    const activitylessAchievements = await db
      .selectFrom('score_ledger as sl')
      .innerJoin('scoring_rules as sr', 'sr.id', 'sl.rule_id')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('sr.rule_kind', '=', 'achievement')
      .where('sl.activity_id', 'is', null)
      .executeTakeFirstOrThrow();
    expect(Number(activitylessAchievements.count)).toBe(0);
  });

  it('rolls back every daily-import phase and records a failed batch', async () => {
    await resetImportTables(db);
    await new ImportService(db).importLocalFiles({ mySportPath });
    const baseline = await importCounts(db);
    const baselineIds = await canonicalIds(db);

    const phases: ImportFailurePhase[] = ['transaction-started', 'raw-stored', 'canonical-written', 'daily-scored', 'batch-finalized'];
    for (const targetPhase of phases) {
      const failingService = new ImportService(db, {
        failureInjector: (phase, context) => {
          if (context.source === 'my_sport_xlsx' && phase === targetPhase) {
            throw new Error(`forced failure at ${targetPhase}`);
          }
        },
      });

      await expect(failingService.importLocalFiles({ mySportPath })).rejects.toThrow(`forced failure at ${targetPhase}`);
      const afterFailure = await importCounts(db);
      expect(canonicalCounts(afterFailure)).toEqual(canonicalCounts(baseline));
      expect(await canonicalIds(db)).toEqual(baselineIds);
      expect(afterFailure.sourceRecords).toBe(baseline.sourceRecords);

      const failedBatch = await db
        .selectFrom('import_batches')
        .select(['status', 'error_count', 'metadata'])
        .orderBy('started_at', 'desc')
        .executeTakeFirstOrThrow();
      expect(failedBatch.status).toBe('failed');
      expect(failedBatch.error_count).toBeGreaterThan(0);
      expect(failedBatch.metadata).toMatchObject({
        failure: {
          phase: targetPhase,
          name: 'Error',
          message: `forced failure at ${targetPhase}`,
        },
      });
    }

    await new ImportService(db).importLocalFiles({ mySportPath });
    const afterRetry = await importCounts(db);
    expect(canonicalCounts(afterRetry)).toEqual(canonicalCounts(baseline));
    expect(await canonicalIds(db)).toEqual(baselineIds);
    expect(afterRetry.sourceRecords).toBe(baseline.sourceRecords * 2);
  });

  it('rolls back every performance-import phase and retries cleanly', async () => {
    await resetImportTables(db);
    await new ImportService(db).importLocalFiles({ runDbPath });
    const baseline = await importCounts(db);
    const baselineIds = await canonicalIds(db);

    const phases: ImportFailurePhase[] = ['transaction-started', 'raw-stored', 'canonical-written', 'batch-finalized'];
    for (const targetPhase of phases) {
      const failingService = new ImportService(db, {
        failureInjector: (phase, context) => {
          if (context.source === 'run_db_xlsx' && phase === targetPhase) {
            throw new Error(`forced failure at ${targetPhase}`);
          }
        },
      });

      await expect(failingService.importLocalFiles({ runDbPath })).rejects.toThrow(`forced failure at ${targetPhase}`);
      const afterFailure = await importCounts(db);
      expect(canonicalCounts(afterFailure)).toEqual(canonicalCounts(baseline));
      expect(await canonicalIds(db)).toEqual(baselineIds);
      expect(afterFailure.sourceRecords).toBe(baseline.sourceRecords);
    }

    await new ImportService(db).importLocalFiles({ runDbPath });
    const afterRetry = await importCounts(db);
    expect(canonicalCounts(afterRetry)).toEqual(canonicalCounts(baseline));
    expect(await canonicalIds(db)).toEqual(baselineIds);
    expect(afterRetry.sourceRecords).toBe(baseline.sourceRecords * 2);
  });
});

interface ImportCounts {
  importBatches: number;
  sourceRecords: number;
  activities: number;
  dailyMetrics: number;
  performanceEvents: number;
  scoreLedger: number;
  activitiesWithoutSource: number;
  dailyMetricsWithoutSource: number;
  performanceEventsWithoutSource: number;
}

interface CanonicalIds {
  activities: string[];
  dailyMetrics: string[];
  performanceEvents: string[];
}

async function importCounts(db: TestDatabase): Promise<ImportCounts> {
  const [
    importBatches,
    sourceRecords,
    activities,
    dailyMetrics,
    performanceEvents,
    scoreLedger,
    activitiesWithoutSource,
    dailyMetricsWithoutSource,
    performanceEventsWithoutSource,
  ] = await Promise.all([
    db.selectFrom('import_batches').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
    db.selectFrom('source_records').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
    db.selectFrom('activities').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
    db.selectFrom('daily_metrics').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
    db.selectFrom('performance_events').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
    db.selectFrom('score_ledger').select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirstOrThrow(),
    db.selectFrom('activities').select((eb) => eb.fn.countAll<number>().as('count')).where('source_record_id', 'is', null).executeTakeFirstOrThrow(),
    db.selectFrom('daily_metrics').select((eb) => eb.fn.countAll<number>().as('count')).where('source_record_id', 'is', null).executeTakeFirstOrThrow(),
    db.selectFrom('performance_events').select((eb) => eb.fn.countAll<number>().as('count')).where('source_record_id', 'is', null).executeTakeFirstOrThrow(),
  ]);

  return {
    importBatches: Number(importBatches.count),
    sourceRecords: Number(sourceRecords.count),
    activities: Number(activities.count),
    dailyMetrics: Number(dailyMetrics.count),
    performanceEvents: Number(performanceEvents.count),
    scoreLedger: Number(scoreLedger.count),
    activitiesWithoutSource: Number(activitiesWithoutSource.count),
    dailyMetricsWithoutSource: Number(dailyMetricsWithoutSource.count),
    performanceEventsWithoutSource: Number(performanceEventsWithoutSource.count),
  };
}

async function canonicalIds(db: TestDatabase): Promise<CanonicalIds> {
  const [activities, dailyMetrics, performanceEvents] = await Promise.all([
    db.selectFrom('activities').select('id').orderBy('source_record_hash', 'asc').orderBy('id', 'asc').execute(),
    db.selectFrom('daily_metrics').select('metric_date').orderBy('metric_date', 'asc').execute(),
    db.selectFrom('performance_events').select('id').orderBy('source_record_hash', 'asc').orderBy('id', 'asc').execute(),
  ]);

  return {
    activities: activities.map((row) => row.id),
    dailyMetrics: dailyMetrics.map((row) => row.metric_date),
    performanceEvents: performanceEvents.map((row) => row.id),
  };
}

function canonicalCounts(counts: ImportCounts): Omit<ImportCounts, 'importBatches' | 'sourceRecords'> {
  const { importBatches: _importBatches, sourceRecords: _sourceRecords, ...canonical } = counts;
  return canonical;
}

async function resetImportTables(db: TestDatabase): Promise<void> {
  await db.deleteFrom('score_ledger').execute();
  await db.deleteFrom('daily_metrics').execute();
  await db.deleteFrom('performance_events').execute();
  await db.deleteFrom('activities').execute();
  await db.deleteFrom('source_records').execute();
  await db.deleteFrom('import_batches').execute();
}

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) throw new Error('SPORTOS_TEST_DATABASE_URL is required for database integration tests.');
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) {
    throw new Error('SPORTOS_TEST_DATABASE_URL must target a database whose name ends in _test or -test.');
  }
  return testDatabaseUrl;
}
