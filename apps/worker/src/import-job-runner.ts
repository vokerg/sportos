import {
  ImportJobsRepository,
  UploadsRepository,
  WorkerDispatchRepository,
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
    private readonly dispatchDb: Kysely<Database>,
    private readonly dataDb: Kysely<Database>,
    private readonly storage: UploadStorage = new LocalUploadStorage(),
    options: ImportJobRunnerOptions = { workerId: 'sportos-worker' },
  ) {
    this.workerId = options.workerId.slice(0, 200);
    this.leaseSeconds = clampInteger(options.leaseSeconds ?? 60, 15, 600);
    this.pollIntervalMs = clampInteger(options.pollIntervalMs ?? 1000, 100, 60_000);
  }

  async processNext(): Promise<boolean> {
    const dispatcher = new WorkerDispatchRepository(this.dispatchDb);
    await dispatcher.recoverStaleImports();
    const job = await dispatcher.claimImport(this.workerId, this.leaseSeconds);
    if (!job) return false;

    try {
      await this.checkCancellation(job.ownerId, job.id);
      await this.updateJob(job.ownerId, (jobs) => jobs.heartbeat(
        job.id,
        this.workerId,
        'reading-upload',
        10,
        this.leaseSeconds,
      ));
      const bytes = await this.storage.read(job.objectKey);

      await this.checkCancellation(job.ownerId, job.id);
      await this.updateJob(job.ownerId, (jobs) => jobs.heartbeat(
        job.id,
        this.workerId,
        'parsing-workbook',
        20,
        this.leaseSeconds,
      ));
      const extract = readWorkbookBuffer(bytes, job.filename);

      let committedBatchId: string | null = null;
      const result = await withAccountContext(this.dataDb, job.ownerId, async (importDb) => {
        const importer = new ImportService(importDb, {
          failureInjector: async (phase, context) => {
            committedBatchId = context.batchId;
            await this.updateJob(job.ownerId, async (jobs) => {
              if (await jobs.cancellationRequested(job.id, this.workerId)) {
                throw new ImportJobCancelledError();
              }
              await jobs.heartbeat(job.id, this.workerId, phase, PHASE_PROGRESS[phase], this.leaseSeconds);
            });
          },
        });
        return importer.importWorkbook({
          workbookKind: job.workbookKind,
          extract,
          uploadId: job.uploadId,
        });
      });

      await withAccountContext(this.dataDb, job.ownerId, async (ownerDb) => {
        const jobs = new ImportJobsRepository(ownerDb);
        if (committedBatchId) await jobs.linkBatch(job.id, this.workerId, committedBatchId);
        await new UploadsRepository(ownerDb).markImported(job.uploadId);
        await jobs.markSucceeded(job.id, this.workerId, toJson(result));
      });
      return true;
    } catch (error) {
      const cancellationRequested = error instanceof ImportJobCancelledError
        || await this.updateJob(
          job.ownerId,
          (jobs) => jobs.cancellationRequested(job.id, this.workerId),
        ).catch(() => false);
      if (cancellationRequested) {
        await this.updateJob(job.ownerId, (jobs) => jobs.markCancelled(job.id, this.workerId));
        return true;
      }

      await withAccountContext(this.dataDb, job.ownerId, async (ownerDb) => {
        await new UploadsRepository(ownerDb).markFailed(job.uploadId, error).catch(() => undefined);
        await new ImportJobsRepository(ownerDb).markFailed(job.id, this.workerId, failureCode(error), error);
      });
      return true;
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const processed = await this.processNext();
      if (!processed) await delay(this.pollIntervalMs, signal);
    }
  }

  private updateJob<T>(
    ownerId: string,
    callback: (jobs: ImportJobsRepository) => Promise<T>,
  ): Promise<T> {
    return withAccountContext(this.dataDb, ownerId, (ownerDb) => callback(new ImportJobsRepository(ownerDb)));
  }

  private async checkCancellation(ownerId: string, jobId: string): Promise<void> {
    const requested = await this.updateJob(ownerId, (jobs) => jobs.cancellationRequested(jobId, this.workerId));
    if (requested) throw new ImportJobCancelledError();
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
