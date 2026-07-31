import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../pool.js';
import {
  ImportJobsRepository,
  ImportQueueFullError,
} from './import-jobs.repository.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('ImportJobsRepository database integration', () => {
  let db: TestDatabase;

  beforeAll(() => {
    db = createDb(requireTestDatabaseUrl());
  });

  beforeEach(async () => {
    await resetJobTables(db);
  });

  afterAll(async () => {
    if (db) {
      await resetJobTables(db);
      await db.destroy();
    }
  });

  it('claims an active job once and preserves monotonic progress through cancellation', async () => {
    const uploadId = await createUpload(db, '11');
    const repo = new ImportJobsRepository(db);
    const queued = await repo.enqueue(uploadId);

    const claimed = await repo.claimNext('worker-a', 60);
    const duplicateDelivery = await repo.claimNext('worker-b', 60);

    expect(claimed).toMatchObject({ id: queued.id, uploadId, attemptCount: 1 });
    expect(duplicateDelivery).toBeNull();

    await repo.heartbeat(queued.id, 'worker-a', 'raw-stored', 45, 60);
    await repo.heartbeat(queued.id, 'worker-a', 'older-phase', 30, 60);
    expect(await repo.getById(queued.id)).toMatchObject({
      status: 'running',
      phase: 'older-phase',
      progressPercent: 45,
      attemptCount: 1,
    });

    const cancelling = await repo.requestCancellation(queued.id);
    expect(cancelling).toMatchObject({ status: 'running', cancellationRequested: true, phase: 'cancelling' });
    expect(await repo.cancellationRequested(queued.id, 'worker-a')).toBe(true);

    await repo.markCancelled(queued.id, 'worker-a');
    expect(await repo.getById(queued.id)).toMatchObject({
      status: 'cancelled',
      phase: 'cancelled',
      progressPercent: 45,
    });
  });

  it('retries a failed job without duplicating the durable job identity', async () => {
    const uploadId = await createUpload(db, '22');
    const repo = new ImportJobsRepository(db);
    const queued = await repo.enqueue(uploadId, 3);
    await repo.claimNext('worker-a', 60);
    await repo.markFailed(queued.id, 'worker-a', 'FORCED_FAILURE', new Error('forced failure'));

    const failed = await repo.getById(queued.id);
    expect(failed).toMatchObject({ status: 'failed', attemptCount: 1, error: { code: 'FORCED_FAILURE' } });

    const retried = await repo.retry(queued.id);
    expect(retried).toMatchObject({ id: queued.id, status: 'queued', attemptCount: 1, progressPercent: 0 });

    const secondAttempt = await repo.claimNext('worker-b', 60);
    expect(secondAttempt).toMatchObject({ id: queued.id, attemptCount: 2 });
    await repo.markSucceeded(queued.id, 'worker-b', { ok: true });
    expect(await repo.getById(queued.id)).toMatchObject({
      id: queued.id,
      status: 'succeeded',
      attemptCount: 2,
      progressPercent: 100,
      result: { ok: true },
    });
  });

  it('recovers an expired lease and permits a safe second claim', async () => {
    const uploadId = await createUpload(db, '33');
    const repo = new ImportJobsRepository(db);
    const queued = await repo.enqueue(uploadId, 3);
    await repo.claimNext('lost-worker', 60);
    await db
      .updateTable('import_jobs')
      .set({ lease_expires_at: new Date(Date.now() - 60_000) })
      .where('id', '=', queued.id)
      .execute();

    await expect(repo.recoverStale()).resolves.toEqual({ requeued: 1, failed: 0, cancelled: 0 });
    expect(await repo.getById(queued.id)).toMatchObject({
      status: 'queued',
      phase: 'recovered',
      attemptCount: 1,
    });

    const recovered = await repo.claimNext('replacement-worker', 60);
    expect(recovered).toMatchObject({ id: queued.id, attemptCount: 2 });
  });

  it('cancels queued work immediately and enforces the active queue limit', async () => {
    const firstUpload = await createUpload(db, '44');
    const secondUpload = await createUpload(db, '55');
    const repo = new ImportJobsRepository(db, { queueLimit: 1 });
    const first = await repo.enqueue(firstUpload);

    await expect(repo.enqueue(secondUpload)).rejects.toBeInstanceOf(ImportQueueFullError);
    const cancelled = await repo.requestCancellation(first.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', phase: 'cancelled' });
    expect(await repo.claimNext('worker-a', 60)).toBeNull();

    await expect(repo.enqueue(secondUpload)).resolves.toMatchObject({ status: 'queued' });
  });
});

async function createUpload(db: TestDatabase, seed: string): Promise<string> {
  const id = `${seed.repeat(8).slice(0, 8)}-${seed.repeat(4).slice(0, 4)}-4${seed.repeat(3).slice(0, 3)}-8${seed.repeat(3).slice(0, 3)}-${seed.repeat(12).slice(0, 12)}`;
  await db
    .insertInto('uploaded_files')
    .values({
      id,
      workbook_kind: 'my_sport',
      storage_provider: 'local',
      object_key: `${seed.slice(0, 2).padEnd(2, '0')}/${id}.xlsx`,
      original_filename: `workbook-${seed}.xlsx`,
      sanitized_filename: `workbook-${seed}.xlsx`,
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byte_size: 1024,
      sha256: seed.repeat(64).slice(0, 64),
      status: 'stored',
      last_error: null,
      imported_at: null,
      deleted_at: null,
    })
    .execute();
  return id;
}

async function resetJobTables(db: TestDatabase): Promise<void> {
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
