import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, ImportJobsRepository } from '@sportos/db';
import { LocalUploadStorage } from '@sportos/importers';
import { ImportJobRunner } from './import-job-runner.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

const WORKBOOK_BASE64 = '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';

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
    const bytes = Buffer.from(WORKBOOK_BASE64, 'base64');
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
    expect(completed?.result).toMatchObject({ dailyRows: 1, activities: 2, performanceEvents: 0 });

    const batch = await db.selectFrom('import_batches')
      .select(['id', 'uploaded_file_id', 'status'])
      .where('id', '=', completed!.batchId!)
      .executeTakeFirstOrThrow();
    expect(batch).toMatchObject({ uploaded_file_id: uploadId, status: 'scored' });

    const daily = await db.selectFrom('daily_metrics')
      .select(['metric_date', 'steps', 'run_m'])
      .where('metric_date', '=', '2026-05-18')
      .executeTakeFirstOrThrow();
    expect(daily).toEqual({ metric_date: '2026-05-18', steps: 1000, run_m: 1500 });
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

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) throw new Error('SPORTOS_TEST_DATABASE_URL is required for database integration tests.');
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) {
    throw new Error('SPORTOS_TEST_DATABASE_URL must target a database whose name ends in _test or -test.');
  }
  return testDatabaseUrl;
}
