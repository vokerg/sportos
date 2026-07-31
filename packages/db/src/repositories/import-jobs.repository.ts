import { sql, type Kysely } from 'kysely';
import type { Database, ImportJob, Json } from '../schema.js';

export type ImportJobStatus = ImportJob['status'];

export interface ImportJobReadModel {
  id: string;
  uploadId: string;
  batchId: string | null;
  filename: string;
  workbookKind: 'my_sport' | 'run_db';
  uploadStatus: Database['uploaded_files']['status'];
  status: ImportJobStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  error: { code: string; message: string } | null;
  result: Json;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ClaimedImportJob {
  id: string;
  uploadId: string;
  objectKey: string;
  filename: string;
  workbookKind: 'my_sport' | 'run_db';
  sha256: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface ImportJobRepositoryOptions {
  queueLimit?: number;
}

export class ImportQueueFullError extends Error {
  constructor(readonly limit: number) {
    super(`The import queue already contains ${limit} active jobs.`);
    this.name = 'ImportQueueFullError';
  }
}

export class ActiveImportJobError extends Error {
  constructor(readonly jobId: string) {
    super(`Upload already has active import job ${jobId}.`);
    this.name = 'ActiveImportJobError';
  }
}

export class ImportJobStateError extends Error {
  constructor(readonly code: 'NOT_RETRYABLE' | 'ATTEMPTS_EXHAUSTED' | 'LOST_LEASE', message: string) {
    super(message);
    this.name = 'ImportJobStateError';
  }
}

const QUEUE_ADVISORY_LOCK = 834_110_202;

export class ImportJobsRepository {
  private readonly queueLimit: number;

  constructor(
    private readonly db: Kysely<Database>,
    options: ImportJobRepositoryOptions = {},
  ) {
    this.queueLimit = clampInteger(options.queueLimit ?? 25, 1, 1000);
  }

  async enqueue(uploadId: string, maxAttempts = 3): Promise<ImportJobReadModel> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${QUEUE_ADVISORY_LOCK})`.execute(transaction);

      const existing = await transaction
        .selectFrom('import_jobs')
        .select('id')
        .where('uploaded_file_id', '=', uploadId)
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirst();
      if (existing) throw new ActiveImportJobError(existing.id);

      const active = await transaction
        .selectFrom('import_jobs')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirstOrThrow();
      if (Number(active.count) >= this.queueLimit) throw new ImportQueueFullError(this.queueLimit);

      const row = await transaction
        .insertInto('import_jobs')
        .values({
          uploaded_file_id: uploadId,
          import_batch_id: null,
          status: 'queued',
          phase: 'queued',
          progress_percent: 0,
          attempt_count: 0,
          max_attempts: clampInteger(maxAttempts, 1, 10),
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          cancellation_requested_at: null,
          next_attempt_at: new Date(),
          error_code: null,
          error_message: null,
          result_json: {},
          started_at: null,
          completed_at: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      return this.getByIdUsing(transaction, row.id).then(requireJob);
    });
  }

  getById(jobId: string): Promise<ImportJobReadModel | null> {
    return this.getByIdUsing(this.db, jobId);
  }

  async claimNext(workerId: string, leaseSeconds = 60): Promise<ClaimedImportJob | null> {
    const boundedLeaseSeconds = clampInteger(leaseSeconds, 15, 600);
    return this.db.transaction().execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom('import_jobs as j')
        .innerJoin('uploaded_files as u', 'u.id', 'j.uploaded_file_id')
        .select([
          'j.id',
          'j.uploaded_file_id',
          'j.attempt_count',
          'j.max_attempts',
          'u.object_key',
          'u.sanitized_filename',
          'u.workbook_kind',
          'u.sha256',
        ])
        .where('j.status', '=', 'queued')
        .where('j.next_attempt_at', '<=', new Date())
        .where('j.cancellation_requested_at', 'is', null)
        .where('u.deleted_at', 'is', null)
        .orderBy('j.created_at', 'asc')
        .orderBy('j.id', 'asc')
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!candidate) return null;

      const updated = await transaction
        .updateTable('import_jobs')
        .set({
          status: 'running',
          phase: 'claimed',
          progress_percent: 5,
          attempt_count: sql<number>`attempt_count + 1`,
          lease_owner: workerId.slice(0, 200),
          lease_expires_at: sql<Date>`now() + make_interval(secs => ${boundedLeaseSeconds})`,
          heartbeat_at: new Date(),
          updated_at: new Date(),
          started_at: sql<Date>`coalesce(started_at, now())`,
          completed_at: null,
          error_code: null,
          error_message: null,
        })
        .where('id', '=', candidate.id)
        .where('status', '=', 'queued')
        .returning(['attempt_count', 'max_attempts'])
        .executeTakeFirst();
      if (!updated) return null;

      return {
        id: candidate.id,
        uploadId: candidate.uploaded_file_id,
        objectKey: candidate.object_key,
        filename: safeFilename(candidate.sanitized_filename),
        workbookKind: candidate.workbook_kind,
        sha256: candidate.sha256,
        attemptCount: updated.attempt_count,
        maxAttempts: updated.max_attempts,
      };
    });
  }

  async heartbeat(
    jobId: string,
    workerId: string,
    phase: string,
    progressPercent: number,
    leaseSeconds = 60,
  ): Promise<void> {
    const updated = await this.db
      .updateTable('import_jobs')
      .set({
        phase: safePhase(phase),
        progress_percent: sql<number>`greatest(progress_percent, ${clampInteger(progressPercent, 0, 99)})`,
        heartbeat_at: new Date(),
        lease_expires_at: sql<Date>`now() + make_interval(secs => ${clampInteger(leaseSeconds, 15, 600)})`,
        updated_at: new Date(),
      })
      .where('id', '=', jobId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', workerId.slice(0, 200))
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new ImportJobStateError('LOST_LEASE', 'The worker no longer owns this import job lease.');
  }

  async linkBatch(jobId: string, workerId: string, batchId: string): Promise<void> {
    const updated = await this.db
      .updateTable('import_jobs')
      .set({ import_batch_id: batchId, updated_at: new Date() })
      .where('id', '=', jobId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', workerId.slice(0, 200))
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new ImportJobStateError('LOST_LEASE', 'The worker cannot link a batch after losing its lease.');
  }

  async cancellationRequested(jobId: string, workerId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('import_jobs')
      .select('cancellation_requested_at')
      .where('id', '=', jobId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', workerId.slice(0, 200))
      .executeTakeFirst();
    if (!row) throw new ImportJobStateError('LOST_LEASE', 'The worker no longer owns this import job lease.');
    return row.cancellation_requested_at !== null;
  }

  async markSucceeded(jobId: string, workerId: string, result: Json): Promise<void> {
    await this.terminalUpdate(jobId, workerId, {
      status: 'succeeded',
      phase: 'completed',
      progress_percent: 100,
      result_json: jsonb(result),
      error_code: null,
      error_message: null,
    });
  }

  async markFailed(jobId: string, workerId: string, code: string, error: unknown): Promise<void> {
    const rawMessage = error instanceof Error ? error.message : String(error);
    await this.terminalUpdate(jobId, workerId, {
      status: 'failed',
      phase: 'failed',
      error_code: safeCode(code),
      error_message: redactSensitiveText(rawMessage).slice(0, 500),
    });
  }

  async markCancelled(jobId: string, workerId: string): Promise<void> {
    await this.terminalUpdate(jobId, workerId, {
      status: 'cancelled',
      phase: 'cancelled',
      error_code: null,
      error_message: null,
    });
  }

  async requestCancellation(jobId: string): Promise<ImportJobReadModel | null> {
    return this.db.transaction().execute(async (transaction) => {
      const job = await transaction
        .selectFrom('import_jobs')
        .selectAll()
        .where('id', '=', jobId)
        .forUpdate()
        .executeTakeFirst();
      if (!job) return null;

      if (job.status === 'queued') {
        await transaction
          .updateTable('import_jobs')
          .set({
            status: 'cancelled',
            phase: 'cancelled',
            cancellation_requested_at: new Date(),
            completed_at: new Date(),
            updated_at: new Date(),
          })
          .where('id', '=', jobId)
          .execute();
      } else if (job.status === 'running' && job.cancellation_requested_at === null) {
        await transaction
          .updateTable('import_jobs')
          .set({ cancellation_requested_at: new Date(), phase: 'cancelling', updated_at: new Date() })
          .where('id', '=', jobId)
          .execute();
      }

      return this.getByIdUsing(transaction, jobId).then(requireJob);
    });
  }

  async retry(jobId: string): Promise<ImportJobReadModel | null> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${QUEUE_ADVISORY_LOCK})`.execute(transaction);
      const job = await transaction
        .selectFrom('import_jobs')
        .selectAll()
        .where('id', '=', jobId)
        .forUpdate()
        .executeTakeFirst();
      if (!job) return null;
      if (job.status !== 'failed') {
        throw new ImportJobStateError('NOT_RETRYABLE', 'Only failed import jobs can be retried.');
      }
      if (job.attempt_count >= job.max_attempts) {
        throw new ImportJobStateError('ATTEMPTS_EXHAUSTED', 'This import job has exhausted its retry attempts.');
      }

      const active = await transaction
        .selectFrom('import_jobs')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirstOrThrow();
      if (Number(active.count) >= this.queueLimit) throw new ImportQueueFullError(this.queueLimit);

      await transaction
        .updateTable('import_jobs')
        .set({
          status: 'queued',
          phase: 'queued',
          progress_percent: 0,
          lease_owner: null,
          lease_expires_at: null,
          heartbeat_at: null,
          cancellation_requested_at: null,
          next_attempt_at: new Date(),
          error_code: null,
          error_message: null,
          result_json: {},
          updated_at: new Date(),
          completed_at: null,
        })
        .where('id', '=', jobId)
        .execute();

      return this.getByIdUsing(transaction, jobId).then(requireJob);
    });
  }

  async recoverStale(limit = 100): Promise<{ requeued: number; failed: number; cancelled: number }> {
    return this.db.transaction().execute(async (transaction) => {
      const stale = await transaction
        .selectFrom('import_jobs')
        .select(['id', 'attempt_count', 'max_attempts', 'cancellation_requested_at'])
        .where('status', '=', 'running')
        .where('lease_expires_at', '<', new Date())
        .orderBy('lease_expires_at', 'asc')
        .limit(clampInteger(limit, 1, 1000))
        .forUpdate()
        .skipLocked()
        .execute();

      const counts = { requeued: 0, failed: 0, cancelled: 0 };
      for (const job of stale) {
        if (job.cancellation_requested_at !== null) {
          await transaction
            .updateTable('import_jobs')
            .set(terminalValues('cancelled', 'cancelled', null, null))
            .where('id', '=', job.id)
            .execute();
          counts.cancelled += 1;
        } else if (job.attempt_count >= job.max_attempts) {
          await transaction
            .updateTable('import_jobs')
            .set(terminalValues('failed', 'failed', 'STALE_LEASE', 'Worker lease expired after the final attempt.'))
            .where('id', '=', job.id)
            .execute();
          counts.failed += 1;
        } else {
          await transaction
            .updateTable('import_jobs')
            .set({
              status: 'queued',
              phase: 'recovered',
              lease_owner: null,
              lease_expires_at: null,
              heartbeat_at: null,
              next_attempt_at: new Date(),
              updated_at: new Date(),
              error_code: 'STALE_LEASE_RECOVERED',
              error_message: 'The previous worker lease expired; the job was safely requeued.',
            })
            .where('id', '=', job.id)
            .execute();
          counts.requeued += 1;
        }
      }
      return counts;
    });
  }

  private async terminalUpdate(
    jobId: string,
    workerId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.db
      .updateTable('import_jobs')
      .set({
        ...values,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: new Date(),
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', jobId)
      .where('status', '=', 'running')
      .where('lease_owner', '=', workerId.slice(0, 200))
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new ImportJobStateError('LOST_LEASE', 'The worker cannot complete a job after losing its lease.');
  }

  private async getByIdUsing(db: Kysely<Database>, jobId: string): Promise<ImportJobReadModel | null> {
    const row = await db
      .selectFrom('import_jobs as j')
      .innerJoin('uploaded_files as u', 'u.id', 'j.uploaded_file_id')
      .select([
        'j.id',
        'j.uploaded_file_id',
        'j.import_batch_id',
        'j.status',
        'j.phase',
        'j.progress_percent',
        'j.attempt_count',
        'j.max_attempts',
        'j.cancellation_requested_at',
        'j.error_code',
        'j.error_message',
        'j.result_json',
        'j.created_at',
        'j.updated_at',
        'j.started_at',
        'j.completed_at',
        'u.sanitized_filename',
        'u.workbook_kind',
        'u.status as upload_status',
      ])
      .where('j.id', '=', jobId)
      .executeTakeFirst();
    return row ? {
      id: row.id,
      uploadId: row.uploaded_file_id,
      batchId: row.import_batch_id,
      filename: safeFilename(row.sanitized_filename),
      workbookKind: row.workbook_kind,
      uploadStatus: row.upload_status,
      status: row.status,
      phase: row.phase,
      progressPercent: row.progress_percent,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      cancellationRequested: row.cancellation_requested_at !== null,
      error: row.error_code && row.error_message
        ? { code: row.error_code, message: redactSensitiveText(row.error_message).slice(0, 500) }
        : null,
      result: row.result_json,
      createdAt: timestampToIso(row.created_at),
      updatedAt: timestampToIso(row.updated_at),
      startedAt: row.started_at === null ? null : timestampToIso(row.started_at),
      completedAt: row.completed_at === null ? null : timestampToIso(row.completed_at),
    } : null;
  }
}

function terminalValues(
  status: 'failed' | 'cancelled',
  phase: string,
  errorCode: string | null,
  errorMessage: string | null,
) {
  return {
    status,
    phase,
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: new Date(),
    completed_at: new Date(),
    updated_at: new Date(),
    error_code: errorCode,
    error_message: errorMessage,
  } as const;
}

function jsonb(value: Json) {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}

function requireJob(job: ImportJobReadModel | null): ImportJobReadModel {
  if (!job) throw new Error('Import job disappeared during a locked operation.');
  return job;
}

function safeFilename(filename: string): string {
  const value = filename.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)?.trim();
  return (value || 'workbook.xlsx').slice(0, 255);
}

function safePhase(value: string): string {
  return value.trim().slice(0, 120) || 'running';
}

function safeCode(value: string): string {
  return value.trim().replace(/[^A-Z0-9_]+/gi, '_').toUpperCase().slice(0, 120) || 'IMPORT_JOB_FAILED';
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(["'`])(?:[A-Za-z]:[\\/]|\/)[^"'`\r\n]+\1/g, '$1[redacted local path]$1')
    .replace(/\b[A-Za-z]:[\\/][^\s,;]+/g, '[redacted local path]')
    .replace(/(^|\s)\/(?:[^/\s]+\/)*[^/\s,;]+/g, '$1[redacted local path]');
}

function timestampToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
  }
  return String(value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
