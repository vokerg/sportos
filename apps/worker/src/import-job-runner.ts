import {
  ImportJobsRepository,
  UploadsRepository,
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
  private readonly jobs: ImportJobsRepository;
  private readonly uploads: UploadsRepository;
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly db: Kysely<Database>,
    options: ImportJobRunnerOptions,
    private readonly storage: UploadStorage = new LocalUploadStorage(),
  ) {
    this.jobs = new ImportJobsRepository(db);
    this.uploads = new UploadsRepository(db);
    this.workerId = options.workerId.slice(0, 200);
    this.leaseSeconds = clampInteger(options.leaseSeconds ?? 60, 15, 600);
    this.pollIntervalMs = clampInteger(options.pollIntervalMs ?? 1000, 100, 60_000);
  }

  async processNext(): Promise<boolean> {
    await this.jobs.recoverStale();
    const job = await this.jobs.claimNext(this.workerId, this.leaseSeconds);
    if (!job) return false;

    try {
      await this.checkCancellation(job.id);
      await this.jobs.heartbeat(job.id, this.workerId, 'reading-upload', 10, this.leaseSeconds);
      const bytes = await this.storage.read(job.objectKey);

      await this.checkCancellation(job.id);
      await this.jobs.heartbeat(job.id, this.workerId, 'parsing-workbook', 20, this.leaseSeconds);
      const extract = readWorkbookBuffer(bytes, job.filename);

      let linkedBatchId: string | null = null;
      const importer = new ImportService(this.db, {
        failureInjector: async (phase, context) => {
          if (linkedBatchId !== context.batchId) {
            await this.jobs.linkBatch(job.id, this.workerId, context.batchId);
            linkedBatchId = context.batchId;
          }
          await this.checkCancellation(job.id);
          await this.jobs.heartbeat(job.id, this.workerId, phase, PHASE_PROGRESS[phase], this.leaseSeconds);
        },
      });

      const result = await importer.importWorkbook({
        workbookKind: job.workbookKind,
        extract,
        uploadId: job.uploadId,
      });
      await this.uploads.markImported(job.uploadId);
      await this.jobs.markSucceeded(job.id, this.workerId, toJson(result));
      return true;
    } catch (error) {
      const cancellationRequested = error instanceof ImportJobCancelledError
        || await this.jobs.cancellationRequested(job.id, this.workerId).catch(() => false);
      if (cancellationRequested) {
        await this.jobs.markCancelled(job.id, this.workerId);
        return true;
      }

      await this.uploads.markFailed(job.uploadId, error).catch(() => undefined);
      await this.jobs.markFailed(job.id, this.workerId, failureCode(error), error);
      return true;
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const processed = await this.processNext();
      if (!processed) await delay(this.pollIntervalMs, signal);
    }
  }

  private async checkCancellation(jobId: string): Promise<void> {
    if (await this.jobs.cancellationRequested(jobId, this.workerId)) {
      throw new ImportJobCancelledError();
    }
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
