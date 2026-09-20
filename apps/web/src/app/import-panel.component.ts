import { HttpEventType } from '@angular/common/http';
import { Component, EventEmitter, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ImportsApiService } from './features/imports/data-access/imports-api.service';
import type {
  ImportBatchDetail,
  ImportBatchHistoryItem,
  ImportJob,
  UploadWorkbookKind,
} from './features/imports/model/imports.models';
import { pollDurableJob } from './core/jobs/durable-job-poller';
import { ImportBatchDetailComponent } from './import-batch-detail.component';
import { ImportHistoryComponent } from './import-history.component';
import { ImportJobProgressComponent } from './import-job-progress.component';
import { ImportUploadComponent } from './import-upload.component';
import {
  describeImportRequestError,
  describeImportUploadError,
  importJobSuccessMessage,
  isActiveImportJob,
  isTerminalImportJob,
  type ImportRequestState,
} from './import-workflow.view-model';

@Component({
  selector: 'sportos-import-panel',
  standalone: true,
  imports: [
    ImportUploadComponent,
    ImportJobProgressComponent,
    ImportHistoryComponent,
    ImportBatchDetailComponent,
  ],
  outputs: ['reconcileDate'],
  template: `
    <section class="card import-card">
      <div class="section-heading">
        <div>
          <h2>Imports</h2>
          <p class="help">Upload a supported workbook or Garmin CSV, then follow its durable job, provenance batch, affected dates, and row diagnostics.</p>
        </div>
      </div>

      <sportos-import-upload
        [workbookKind]="workbookKind"
        [selectedFilename]="selectedFilename()"
        [uploadProgress]="uploadProgress()"
        [loading]="importState() === 'loading'"
        [hasSelectedFile]="selectedFile !== null"
        (workbookKindChange)="workbookKind = $event"
        (fileSelected)="onFileSelected($event)"
        (uploadRequested)="import($event)" />

      <sportos-import-job-progress
        [job]="activeJob()"
        [message]="importMessage()"
        [error]="importState() === 'error'"
        (cancelRequested)="cancelActiveJob()"
        (retryRequested)="retryActiveJob()" />

      <sportos-import-history
        [state]="historyState()"
        [items]="history()"
        [total]="historyTotal()"
        [errorMessage]="historyError()"
        [selectedBatchId]="selectedBatchId()"
        (refreshRequested)="loadHistory()"
        (batchSelected)="selectBatch($event)" />

      <sportos-import-batch-detail
        [state]="detailState()"
        [detail]="detail()"
        [errorMessage]="detailError()"
        [loadingMoreDiagnostics]="loadingMoreDiagnostics()"
        (retryRequested)="retryDetail()"
        (reconcileDate)="openReconciliation($event)"
        (loadMoreDiagnosticsRequested)="loadMoreDiagnostics()" />
    </section>
  `,
  styles: [`
    .import-card { display: grid; gap: 16px; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .section-heading h2 { margin-bottom: 4px; }
    .help { color: #667085; font-size: 13px; }
    @media (max-width: 620px) { .section-heading { align-items: stretch; flex-direction: column; } }
  `],
})
export class ImportPanelComponent implements OnInit, OnDestroy {
  readonly reconcileDate = new EventEmitter<string>();

  workbookKind: UploadWorkbookKind = 'my_sport';
  selectedFile: File | null = null;
  readonly selectedFilename = signal<string | null>(null);
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

  private historySubscription?: Subscription;
  private detailSubscription?: Subscription;
  private importSubscription?: Subscription;
  private jobSubscription?: Subscription;

  constructor(private readonly api: ImportsApiService) {}

  ngOnInit(): void {
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.historySubscription?.unsubscribe();
    this.detailSubscription?.unsubscribe();
    this.importSubscription?.unsubscribe();
    this.jobSubscription?.unsubscribe();
  }

  onFileSelected(file: File | null): void {
    this.selectedFile = file;
    this.selectedFilename.set(file?.name ?? null);
    this.importMessage.set(null);
    if (!isActiveImportJob(this.activeJob())) this.importState.set('idle');
    this.uploadProgress.set(null);
  }

  import(fileInput?: HTMLInputElement): void {
    const file = this.selectedFile;
    if (!file) {
      this.importState.set('error');
      this.importMessage.set('Choose a supported import file before starting the import.');
      return;
    }

    this.importSubscription?.unsubscribe();
    this.jobSubscription?.unsubscribe();
    this.activeJob.set(null);
    this.importState.set('loading');
    this.importMessage.set(null);
    this.uploadProgress.set(0);
    this.importSubscription = this.api.uploadWorkbook(file, this.workbookKind).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? file.size;
          this.uploadProgress.set(total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0);
          return;
        }
        if (event.type !== HttpEventType.Response || !event.body) return;

        const response = event.body;
        this.clearSelectedFile(fileInput);
        this.uploadProgress.set(null);
        this.activeJob.set(response.job);
        this.importMessage.set(`Uploaded ${response.upload.filename}. Job queued for the import worker.`);
        this.monitorJob(response.job.id);
      },
      error: (error: unknown) => {
        this.clearSelectedFile(fileInput);
        this.uploadProgress.set(null);
        this.importState.set('error');
        this.importMessage.set(describeImportUploadError(error));
        this.loadHistory();
      },
    });
  }

  cancelActiveJob(): void {
    const job = this.activeJob();
    if (!job || !isActiveImportJob(job)) return;
    this.api.cancelImportJob(job.id).subscribe({
      next: (updated) => {
        this.activeJob.set(updated);
        if (isTerminalImportJob(updated)) this.handleTerminalJob(updated);
        else this.importMessage.set('Cancellation requested. Waiting for the worker to reach a safe phase boundary.');
      },
      error: (error: unknown) => {
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
    this.api.retryImportJob(job.id).subscribe({
      next: (updated) => {
        this.activeJob.set(updated);
        this.monitorJob(updated.id);
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

  openReconciliation(date: string): void {
    this.reconcileDate.emit(date);
  }

  private monitorJob(jobId: string): void {
    this.jobSubscription?.unsubscribe();
    this.jobSubscription = pollDurableJob(
      () => this.api.importJob(jobId),
      {
        intervalMs: 1500,
        maxAttempts: 120,
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

  private clearSelectedFile(fileInput?: HTMLInputElement): void {
    this.selectedFile = null;
    this.selectedFilename.set(null);
    if (fileInput) fileInput.value = '';
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
