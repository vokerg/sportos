import {
  ImportJobsRepository,
  UploadsRepository,
  withAccountContext,
  type Database,
  type Json,
  type Kysely,
} from '@sportos/db';
import {
  ImportService,
  LocalUploadStorage,
  readWorkbookBuffer,
  type ImportFailurePhase,
  type ImportLocalFilesResult,
  type UploadStorage,
} from '@sportos/importers';

export interface ImportJobRunnerOptions {
  workerId: string;
  leaseSeconds?: number;
  pollIntervalMs?: number;
}

export class ImportJobCancelledError extends Error {
  constructor() {
    super('Import job cancellation was requested.');
    this.name = 'ImportJobCancelledError';
  }
}

const PHASE_PROGRESS: Record<ImportFailurePhase, number> = {
  'transaction-started': 30,
  'raw-stored': 45,
  'canonical-written': 70,
  'daily-scored': 88,
  'batch-finalized': 95,
};

export class ImportJobRunner {
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly storage: UploadStorage = new LocalUploadStorage(),
    options: ImportJobRunnerOptions = { workerId: 'sportos-worker' },
  ) {
    this.workerId = options.workerId.slice(0, 200);
    this.leaseSeconds = clampInteger(options.leaseSeconds ?? 60, 15, 600);
    this.pollIntervalMs = clampInteger(options.pollIntervalMs ?? 1000, 100, 60_000);
  }

  async processNext(): Promise<boolean> {
    const systemJobs = new ImportJobsRepository(this.db);
    await systemJobs.recoverStale();
    const job = await systemJobs.claimNext(this.workerId, this.leaseSeconds);
    if (!job) return false;

    const owner = await this.db
      .selectFrom('import_jobs')
      .select('owner_id')
      .where('id', '=', job.id)
      .executeTakeFirstOrThrow();

    return withAccountContext(this.db, owner.owner_id, async (scopedDb) => {
      const jobs = new ImportJobsRepository(scopedDb);
      const uploads = new UploadsRepository(scopedDb);
      try {
        await this.checkCancellation(jobs, job.id);
        await jobs.heartbeat(job.id, this.workerId, 'reading-upload', 10, this.leaseSeconds);
        const bytes = await this.storage.read(job.objectKey);

        await this.checkCancellation(jobs, job.id);
        await jobs.heartbeat(job.id, this.workerId, 'parsing-workbook', 20, this.leaseSeconds);
        const extract = readWorkbookBuffer(bytes, job.filename);

        let linkedBatchId: string | null = null;
        const importer = new ImportService(scopedDb, {
          failureInjector: async (phase, context) => {
            if (linkedBatchId !== context.batchId) {
              await jobs.linkBatch(job.id, this.workerId, context.batchId);
              linkedBatchId = context.batchId;
            }
            await this.checkCancellation(jobs, job.id);
            await jobs.heartbeat(job.id, this.workerId, phase, PHASE_PROGRESS[phase], this.leaseSeconds);
          },
        });

        const result = await importer.importWorkbook({
          workbookKind: job.workbookKind,
          extract,
          uploadId: job.uploadId,
        });
        await uploads.markImported(job.uploadId);
        await jobs.markSucceeded(job.id, this.workerId, toJson(result));
        return true;
      } catch (error) {
        const cancellationRequested = error instanceof ImportJobCancelledError
          || await jobs.cancellationRequested(job.id, this.workerId).catch(() => false);
        if (cancellationRequested) {
          await jobs.markCancelled(job.id, this.workerId);
          return true;
        }

        await uploads.markFailed(job.uploadId, error).catch(() => undefined);
        await jobs.markFailed(job.id, this.workerId, failureCode(error), error);
        return true;
      }
    });
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const processed = await this.processNext();
      if (!processed) await delay(this.pollIntervalMs, signal);
    }
  }

  private async checkCancellation(jobs: ImportJobsRepository, jobId: string): Promise<void> {
    if (await jobs.cancellationRequested(jobId, this.workerId)) throw new ImportJobCancelledError();
  }
}

function failureCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Z0-9]+/gi, '_').toUpperCase().slice(0, 120);
  }
  return 'IMPORT_JOB_FAILED';
}

function toJson(result: ImportLocalFilesResult): Json {
  return JSON.parse(JSON.stringify(result)) as Json;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
