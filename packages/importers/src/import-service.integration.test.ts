import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createDb, type Database } from '@sportos/db';
import { ImportService, type ImportFailurePhase } from './import-service.js';
import { writeMySportFixture, writeRunDbFixture } from './test-fixtures/xlsx-fixtures.js';

const databaseDescribe = process.env.DATABASE_URL ? describe : describe.skip;

databaseDescribe('ImportService database integration', () => {
  let db: Kysely<Database>;
  let directory: string;
  let mySportPath: string;
  let runDbPath: string;

  beforeAll(async () => {
    db = createDb();
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
    const second = await service.importLocalFiles({ mySportPath, runDbPath });
    const secondCounts = await importCounts(db);

    expect(first).toMatchObject({ dailyRows: 2, activities: 13, performanceEvents: 7 });
    expect(second).toMatchObject({ dailyRows: 2, activities: 13, performanceEvents: 7 });
    expect(canonicalCounts(secondCounts)).toEqual(canonicalCounts(firstCounts));
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
  });

  it('rolls back every daily-import phase and records a failed batch', async () => {
    await resetImportTables(db);
    await new ImportService(db).importLocalFiles({ mySportPath });
    const baseline = await importCounts(db);

    const phases: ImportFailurePhase[] = ['raw-stored', 'canonical-written', 'daily-scored', 'batch-finalized'];
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
    expect(afterRetry.sourceRecords).toBe(baseline.sourceRecords * 2);
  });

  it('rolls back every performance-import phase and retries cleanly', async () => {
    await resetImportTables(db);
    await new ImportService(db).importLocalFiles({ runDbPath });
    const baseline = await importCounts(db);

    const phases: ImportFailurePhase[] = ['raw-stored', 'canonical-written', 'batch-finalized'];
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
      expect(afterFailure.sourceRecords).toBe(baseline.sourceRecords);
    }

    await new ImportService(db).importLocalFiles({ runDbPath });
    const afterRetry = await importCounts(db);
    expect(canonicalCounts(afterRetry)).toEqual(canonicalCounts(baseline));
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

async function importCounts(db: Kysely<Database>): Promise<ImportCounts> {
  const result = await sql<ImportCounts>`
    SELECT
      (SELECT count(*)::integer FROM import_batches) AS "importBatches",
      (SELECT count(*)::integer FROM source_records) AS "sourceRecords",
      (SELECT count(*)::integer FROM activities) AS activities,
      (SELECT count(*)::integer FROM daily_metrics) AS "dailyMetrics",
      (SELECT count(*)::integer FROM performance_events) AS "performanceEvents",
      (SELECT count(*)::integer FROM score_ledger) AS "scoreLedger",
      (SELECT count(*)::integer FROM activities WHERE source_record_id IS NULL) AS "activitiesWithoutSource",
      (SELECT count(*)::integer FROM daily_metrics WHERE source_record_id IS NULL) AS "dailyMetricsWithoutSource",
      (SELECT count(*)::integer FROM performance_events WHERE source_record_id IS NULL) AS "performanceEventsWithoutSource"
  `.execute(db);
  const counts = result.rows[0];
  if (!counts) throw new Error('Import count query returned no row.');
  return counts;
}

function canonicalCounts(counts: ImportCounts): Omit<ImportCounts, 'importBatches' | 'sourceRecords'> {
  const { importBatches: _importBatches, sourceRecords: _sourceRecords, ...canonical } = counts;
  return canonical;
}

async function resetImportTables(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      score_ledger,
      daily_metrics,
      performance_events,
      activities,
      source_records,
      import_batches
    CASCADE
  `.execute(db);
}
