import { HttpEventType } from '@angular/common/http';
import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { pollDurableJob } from '../../../core/jobs/durable-job-poller';
import { ImportsApiService } from '../data-access/imports-api.service';
import { describeImportRequestError, describeImportUploadError } from '../data-access/import-errors';
import type {
  ImportBatchDetail,
  ImportBatchHistoryItem,
  ImportJob,
  UploadWorkbookKind,
} from '../model/imports.models';
import {
  importJobSuccessMessage,
  isActiveImportJob,
  isTerminalImportJob,
  type ImportRequestState,
} from '../model/import-workflow.view-model';

const IMPORT_POLL_INTERVAL_MS = 1_500;
const IMPORT_POLL_MAX_ATTEMPTS = 120;

@Injectable()
export class ImportsStore implements OnDestroy {
  readonly workbookKind = signal<UploadWorkbookKind>('my_sport');
  readonly selectedFile = signal<File | null>(null);
  readonly selectedFilename = computed(() => this.selectedFile()?.name ?? null);
  readonly uploadProgress = signal<number | null>(null);
  readonly activeJob = signal<ImportJob | null>(null);
  readonly historyState = signal<ImportRequestState>('idle');
  readonly history = signal<ImportBatchHistoryItem[]>([]);
  readonly historyTotal = signal(0);
  readonly historyError = signal<string | null>(null);
  readonly selectedBatchId = signal<string | null>(null);
  readonly detailState = signal<ImportRequestState>('idle');
  readonly detail = signal<ImportBatchDetail | null>(null);
  readonly detailError = signal<string | null>(null);
  readonly loadingMoreDiagnostics = signal(false);
  readonly importState = signal<ImportRequestState>('idle');
  readonly importMessage = signal<string | null>(null);
  readonly hasMoreDiagnostics = computed(() => {
    const detail = this.detail();
    return detail !== null && detail.diagnostics.length < detail.diagnosticTotal;
  });

  private initialized = false;
  private historySubscription?: Subscription;
  private detailSubscription?: Subscription;
  private uploadSubscription?: Subscription;
  private jobSubscription?: Subscription;
  private actionSubscription?: Subscription;

  constructor(private readonly api: ImportsApiService) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.historySubscription?.unsubscribe();
    this.detailSubscription?.unsubscribe();
    this.uploadSubscription?.unsubscribe();
    this.jobSubscription?.unsubscribe();
    this.actionSubscription?.unsubscribe();
  }

  setWorkbookKind(workbookKind: UploadWorkbookKind): void {
    this.workbookKind.set(workbookKind);
  }

  selectFile(file: File | null): void {
    this.selectedFile.set(file);
    this.importMessage.set(null);
    if (!isActiveImportJob(this.activeJob())) this.importState.set('idle');
    this.uploadProgress.set(null);
  }

  startImport(): boolean {
    const file = this.selectedFile();
    if (!file) {
      this.importState.set('error');
      this.importMessage.set('Choose a supported import file before starting the import.');
      return false;
    }

    this.uploadSubscription?.unsubscribe();
    this.jobSubscription?.unsubscribe();
    this.actionSubscription?.unsubscribe();
    this.activeJob.set(null);
    this.importState.set('loading');
    this.importMessage.set(null);
    this.uploadProgress.set(0);
    this.uploadSubscription = this.api.uploadWorkbook(file, this.workbookKind()).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? file.size;
          this.uploadProgress.set(total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0);
          return;
        }
        if (event.type !== HttpEventType.Response || !event.body) return;

        const response = event.body;
        this.clearSelectedFile();
        this.uploadProgress.set(null);
        this.activeJob.set(response.job);
        this.importMessage.set(`Uploaded ${response.upload.filename}. Job queued for the import worker.`);
        if (isTerminalImportJob(response.job)) this.handleTerminalJob(response.job);
        else this.monitorJob(response.job.id);
      },
      error: (error: unknown) => {
        this.clearSelectedFile();
        this.uploadProgress.set(null);
        this.importState.set('error');
        this.importMessage.set(describeImportUploadError(error));
        this.loadHistory();
      },
    });
    return true;
  }

  cancelActiveJob(): void {
    const job = this.activeJob();
    if (!job || !isActiveImportJob(job)) return;

    this.actionSubscription?.unsubscribe();
    this.actionSubscription = this.api.cancelImportJob(job.id).subscribe({
      next: (updated) => {
        const current = this.activeJob();
        if (current?.id === job.id && isTerminalImportJob(current)) return;

        this.activeJob.set(updated);
        if (isTerminalImportJob(updated)) {
          this.handleTerminalJob(updated);
          return;
        }
        this.importMessage.set('Cancellation requested. Waiting for the worker to reach a safe phase boundary.');
        this.monitorJob(updated.id);
      },
      error: (error: unknown) => {
        const current = this.activeJob();
        if (current?.id === job.id && isTerminalImportJob(current)) return;

        this.importState.set('error');
        this.importMessage.set(describeImportRequestError(error, 'The import job could not be cancelled.'));
      },
    });
  }

  retryActiveJob(): void {
    const job = this.activeJob();
    if (!job || job.status !== 'failed') return;

    this.jobSubscription?.unsubscribe();
    this.importState.set('loading');
    this.importMessage.set('Requeueing the failed import job…');
    this.actionSubscription?.unsubscribe();
    this.actionSubscription = this.api.retryImportJob(job.id).subscribe({
      next: (updated) => {
        this.activeJob.set(updated);
        if (isTerminalImportJob(updated)) this.handleTerminalJob(updated);
        else this.monitorJob(updated.id);
      },
      error: (error: unknown) => {
        this.importState.set('error');
        this.importMessage.set(describeImportRequestError(error, 'The import job could not be retried.'));
      },
    });
  }

  loadHistory(): void {
    this.historySubscription?.unsubscribe();
    this.historyState.set('loading');
    this.historyError.set(null);
    this.historySubscription = this.api.importHistory().subscribe({
      next: (page) => {
        this.history.set(page.items);
        this.historyTotal.set(page.total);
        this.historyState.set('loaded');
      },
      error: (error: unknown) => {
        this.historyError.set(describeImportRequestError(error, 'Import history could not be loaded.'));
        this.historyState.set('error');
      },
    });
  }

  selectBatch(batch: ImportBatchHistoryItem): void {
    this.loadDetail(batch.id);
  }

  retryDetail(): void {
    const batchId = this.selectedBatchId();
    if (batchId) this.loadDetail(batchId);
  }

  loadMoreDiagnostics(): void {
    const batchId = this.selectedBatchId();
    const current = this.detail();
    if (!batchId || !current || !this.hasMoreDiagnostics()) return;
    this.loadDetail(batchId, current.diagnostics.length, true);
  }

  private monitorJob(jobId: string): void {
    this.jobSubscription?.unsubscribe();
    this.jobSubscription = pollDurableJob(
      () => this.api.importJob(jobId),
      {
        intervalMs: IMPORT_POLL_INTERVAL_MS,
        maxAttempts: IMPORT_POLL_MAX_ATTEMPTS,
        isTerminal: isTerminalImportJob,
      },
    ).subscribe((pollState) => {
      if (pollState.state === 'loading') {
        this.activeJob.set(pollState.job);
        this.importState.set('loading');
        this.importMessage.set(`Import job is ${pollState.job.status}: ${pollState.job.phase}.`);
        return;
      }

      if (pollState.state === 'terminal') {
        this.activeJob.set(pollState.job);
        this.handleTerminalJob(pollState.job);
        return;
      }

      if (pollState.state === 'error') {
        this.importState.set('error');
        this.importMessage.set(describeImportRequestError(pollState.error, 'Import job status could not be loaded.'));
        return;
      }

      if (pollState.job) this.activeJob.set(pollState.job);
      this.importState.set('loaded');
      this.importMessage.set('The job is still active. Automatic polling stopped after 120 checks; reload the page or review history later.');
    });
  }

  private handleTerminalJob(job: ImportJob): void {
    this.jobSubscription?.unsubscribe();
    this.loadHistory();
    if (job.status === 'succeeded') {
      this.importState.set('loaded');
      this.importMessage.set(importJobSuccessMessage(job));
      if (job.batchId) this.loadDetail(job.batchId);
      return;
    }
    if (job.status === 'cancelled') {
      this.importState.set('loaded');
      this.importMessage.set('The import job was cancelled. Any in-progress transaction was rolled back.');
      if (job.batchId) this.loadDetail(job.batchId);
      return;
    }
    this.importState.set('error');
    this.importMessage.set(job.error?.message
      ? `The import job failed during ${job.phase}. ${job.error.message}`
      : `The import job failed during ${job.phase}. Review its batch diagnostics before retrying.`);
    if (job.batchId) this.loadDetail(job.batchId);
  }

  private clearSelectedFile(): void {
    this.selectedFile.set(null);
  }

  private loadDetail(batchId: string, diagnosticOffset = 0, append = false): void {
    this.detailSubscription?.unsubscribe();
    this.selectedBatchId.set(batchId);
    this.detailError.set(null);
    if (append) this.loadingMoreDiagnostics.set(true);
    else this.detailState.set('loading');

    this.detailSubscription = this.api.importBatchDetail(batchId, 100, diagnosticOffset).subscribe({
      next: (page) => {
        if (append) {
          const current = this.detail();
          this.detail.set(current
            ? { ...page, diagnostics: [...current.diagnostics, ...page.diagnostics], diagnosticOffset: 0 }
            : page);
        } else {
          this.detail.set(page);
        }
        this.loadingMoreDiagnostics.set(false);
        this.detailState.set('loaded');
      },
      error: (error: unknown) => {
        this.loadingMoreDiagnostics.set(false);
        this.detailError.set(describeImportRequestError(error, 'Batch details could not be loaded.'));
        this.detailState.set('error');
      },
    });
  }
}
