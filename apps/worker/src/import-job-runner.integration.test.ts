import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, ImportJobsRepository } from '@sportos/db';
import { LocalUploadStorage, writeMySportFixture } from '@sportos/importers';
import { ImportJobRunner } from './import-job-runner.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('ImportJobRunner database integration', () => {
  let db: TestDatabase;
  let directory: string;

  beforeAll(async () => {
    db = createDb(requireTestDatabaseUrl());
    directory = mkdtempSync(join(tmpdir(), 'sportos-job-worker-'));
    await resetImportTables(db);
  });

  afterAll(async () => {
    if (db) {
      await resetImportTables(db);
      await db.destroy();
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('claims, imports, links, and completes a stored workbook independently of the API', async () => {
    const workbookPath = join(directory, 'worker-fixture.xlsx');
    writeMySportFixture(workbookPath);
    const bytes = readFileSync(workbookPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const uploadId = '33333333-3333-4333-8333-333333333333';
    const storage = new LocalUploadStorage(directory);
    const stored = await storage.store({ uploadId, sha256, bytes });

    await db.insertInto('uploaded_files').values({
      id: uploadId,
      workbook_kind: 'my_sport',
      storage_provider: 'local',
      object_key: stored.objectKey,
      original_filename: 'worker-fixture.xlsx',
      sanitized_filename: 'worker-fixture.xlsx',
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byte_size: bytes.length,
      sha256,
      status: 'stored',
      last_error: null,
      imported_at: null,
      deleted_at: null,
    }).execute();

    const jobs = new ImportJobsRepository(db);
    const queued = await jobs.enqueue(uploadId);
    const runner = new ImportJobRunner(db, storage, { workerId: 'integration-worker', leaseSeconds: 60 });

    await expect(runner.processNext()).resolves.toBe(true);
    await expect(runner.processNext()).resolves.toBe(false);

    const completed = await jobs.getById(queued.id);
    expect(completed).toMatchObject({
      status: 'succeeded',
      phase: 'completed',
      progressPercent: 100,
      attemptCount: 1,
      batchId: expect.any(String),
      uploadStatus: 'imported',
    });
    expect(completed?.result).toMatchObject({ dailyRows: 2, activities: 13, performanceEvents: 0 });

    const batch = await db.selectFrom('import_batches')
      .select(['id', 'uploaded_file_id', 'status'])
      .where('id', '=', completed!.batchId!)
      .executeTakeFirstOrThrow();
    expect(batch).toMatchObject({ uploaded_file_id: uploadId, status: 'scored' });

    const daily = await db.selectFrom('daily_metrics')
      .select(['metric_date', 'steps', 'run_m'])
      .where('metric_date', '=', '2026-05-18')
      .executeTakeFirstOrThrow();
    expect({
      metricDate: toIsoDate(daily.metric_date),
      steps: daily.steps,
      runM: Number(daily.run_m),
    }).toEqual({ metricDate: '2026-05-18', steps: 12_345, runM: 13_000 });
  });
});

async function resetImportTables(db: TestDatabase): Promise<void> {
  await db.deleteFrom('score_ledger').execute();
  await db.deleteFrom('daily_metrics').execute();
  await db.deleteFrom('performance_events').execute();
  await db.deleteFrom('activities').execute();
  await db.deleteFrom('source_records').execute();
  await db.deleteFrom('import_jobs').execute();
  await db.deleteFrom('import_batches').execute();
  await db.deleteFrom('uploaded_files').execute();
}

function toIsoDate(value: unknown): string {
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
