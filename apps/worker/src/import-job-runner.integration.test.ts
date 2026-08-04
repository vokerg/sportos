import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, ImportJobsRepository, LEGACY_ACCOUNT_ID, withAccountContext } from '@sportos/db';
import { LocalUploadStorage, writeMySportFixture } from '@sportos/importers';
import { ImportJobRunner } from './import-job-runner.js';

const dispatchDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const dataDatabaseUrl = process.env.SPORTOS_WORKER_DATA_DATABASE_URL;
const databaseDescribe = dispatchDatabaseUrl && dataDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('ImportJobRunner database integration', () => {
  let dispatchDb: TestDatabase;
  let dataDb: TestDatabase;
  let directory: string;

  beforeAll(async () => {
    dispatchDb = createDb(requireDatabaseUrl(dispatchDatabaseUrl, 'SPORTOS_TEST_DATABASE_URL'));
    dataDb = createDb(requireDatabaseUrl(dataDatabaseUrl, 'SPORTOS_WORKER_DATA_DATABASE_URL'));
    directory = mkdtempSync(join(tmpdir(), 'sportos-job-worker-'));
    await resetImportTables(dataDb);
  });

  afterAll(async () => {
    if (dataDb) await resetImportTables(dataDb);
    await Promise.all([dispatchDb?.destroy(), dataDb?.destroy()]);
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('dispatches globally but imports and reads canonical data only through the claimed owner', async () => {
    const workbookPath = join(directory, 'worker-fixture.xlsx');
    writeMySportFixture(workbookPath);
    const bytes = readFileSync(workbookPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const uploadId = '33333333-3333-4333-8333-333333333333';
    const storage = new LocalUploadStorage(directory);
    const stored = await storage.store({ uploadId, sha256, bytes });

    const queued = await withAccountContext(dataDb, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      await ownerDb.insertInto('uploaded_files').values({
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
      return new ImportJobsRepository(ownerDb).enqueue(uploadId);
    });

    const runner = new ImportJobRunner(dispatchDb, dataDb, storage, {
      workerId: 'integration-worker',
      leaseSeconds: 60,
    });

    await expect(runner.processNext()).resolves.toBe(true);
    await expect(runner.processNext()).resolves.toBe(false);

    const completed = await withAccountContext(
      dataDb,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new ImportJobsRepository(ownerDb).getById(queued.id),
    );
    expect(completed).toMatchObject({
      status: 'succeeded',
      phase: 'completed',
      progressPercent: 100,
      attemptCount: 1,
      batchId: expect.any(String),
      uploadStatus: 'imported',
    });
    expect(completed?.result).toMatchObject({ dailyRows: 2, activities: 13, performanceEvents: 0 });

    const evidence = await withAccountContext(dataDb, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      const batch = await ownerDb.selectFrom('import_batches')
        .select(['id', 'uploaded_file_id', 'status', 'owner_id'])
        .where('id', '=', completed!.batchId!)
        .executeTakeFirstOrThrow();
      const daily = await ownerDb.selectFrom('daily_metrics')
        .select(['metric_date', 'steps', 'run_m', 'owner_id'])
        .where('metric_date', '=', '2026-05-18')
        .executeTakeFirstOrThrow();
      return { batch, daily };
    });
    expect(evidence.batch).toMatchObject({
      uploaded_file_id: uploadId,
      status: 'scored',
      owner_id: LEGACY_ACCOUNT_ID,
    });
    expect({
      metricDate: toIsoDate(evidence.daily.metric_date),
      steps: evidence.daily.steps,
      runM: Number(evidence.daily.run_m),
      ownerId: evidence.daily.owner_id,
    }).toEqual({ metricDate: '2026-05-18', steps: 12_345, runM: 13_000, ownerId: LEGACY_ACCOUNT_ID });

    expect(await dispatchDb.selectFrom('daily_metrics').select('metric_date').execute()).toEqual([]);
    expect(await dispatchDb.selectFrom('source_records').select('id').execute()).toEqual([]);
  });
});

async function resetImportTables(db: TestDatabase): Promise<void> {
  await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
    await ownerDb.deleteFrom('score_ledger').execute();
    await ownerDb.deleteFrom('daily_metrics').execute();
    await ownerDb.deleteFrom('performance_events').execute();
    await ownerDb.deleteFrom('activities').execute();
    await ownerDb.deleteFrom('source_records').execute();
    await ownerDb.deleteFrom('import_jobs').execute();
    await ownerDb.deleteFrom('import_batches').execute();
    await ownerDb.deleteFrom('uploaded_files').execute();
  });
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function requireDatabaseUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for database integration tests.`);
  const databaseName = new URL(value).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) {
    throw new Error(`${name} must target a database whose name ends in _test or -test.`);
  }
  return value;
}
