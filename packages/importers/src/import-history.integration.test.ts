import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, ImportsRepository } from '@sportos/db';
import { ImportService } from './import-service.js';
import { writeCleanMySportFixture, writeMySportFixture } from './test-fixtures/xlsx-fixtures.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('import history and diagnostics integration', () => {
  let db: TestDatabase;
  let directory: string;
  let cleanPath: string;
  let warningPath: string;

  beforeAll(async () => {
    db = createDb(requireTestDatabaseUrl());
    directory = mkdtempSync(join(tmpdir(), 'sportos-import-history-'));
    cleanPath = join(directory, 'clean-ledger.xlsx');
    warningPath = join(directory, 'warning-ledger.xlsx');
    writeCleanMySportFixture(cleanPath);
    writeMySportFixture(warningPath);
    await resetImportTables(db);
  });

  afterAll(async () => {
    if (db) {
      await resetImportTables(db);
      await db.destroy();
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('returns inspectable clean, warning-bearing, and failed batches', async () => {
    const cleanResult = await new ImportService(db).importLocalFiles({ mySportPath: cleanPath });
    const warningResult = await new ImportService(db).importLocalFiles({ mySportPath: warningPath });
    const failingService = new ImportService(db, {
      failureInjector: (phase) => {
        if (phase === 'transaction-started') throw new Error('forced history failure');
      },
    });
    await expect(failingService.importLocalFiles({ mySportPath: warningPath })).rejects.toThrow('forced history failure');

    const repository = new ImportsRepository(db);
    const history = await repository.listBatches(10, 0);
    const cleanBatchId = cleanResult.batches[0]!.id;
    const warningBatchId = warningResult.batches[0]!.id;
    const failedBatch = history.items.find((item) => item.status === 'failed');

    expect(history.total).toBe(3);
    expect(history.items.every((item) => item.filename && !item.filename.includes('/'))).toBe(true);
    expect(failedBatch).toBeDefined();

    const cleanDetail = await repository.getBatchDetail(cleanBatchId);
    expect(cleanDetail).not.toBeNull();
    expect(cleanDetail!.batch).toMatchObject({
      status: 'scored',
      warningCount: 0,
      errorCount: 0,
      affectedDates: ['2026-05-18'],
    });
    expect(cleanDetail!.diagnosticTotal).toBe(0);
    expect(cleanDetail!.transitions.map((transition) => transition.status)).toEqual([
      'started',
      'parsed',
      'normalized',
      'scored',
    ]);

    const warningDetail = await repository.getBatchDetail(warningBatchId);
    expect(warningDetail).not.toBeNull();
    expect(warningDetail!.batch.status).toBe('scored');
    expect(warningDetail!.batch.warningCount).toBe(warningResult.warnings.length);
    expect(warningDetail!.batch.affectedDates).toEqual(['2026-05-18', '2026-05-19']);
    expect(warningDetail!.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        code: 'ROW_SKIPPED',
        sheetName: 'Sheet1',
        rowIndex: 3,
      }),
      expect.objectContaining({
        severity: 'warning',
        code: 'COLUMN_IGNORED',
      }),
    ]));

    const failedDetail = await repository.getBatchDetail(failedBatch!.id);
    expect(failedDetail).not.toBeNull();
    expect(failedDetail!.batch).toMatchObject({ status: 'failed', errorCount: 1 });
    expect(failedDetail!.batch.failure).toMatchObject({
      phase: 'transaction-started',
      name: 'Error',
      message: 'forced history failure',
    });
    expect(failedDetail!.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'IMPORT_FAILED', phase: 'transaction-started' }),
    ]));
  });
});

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
