import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, EventEmitter, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, switchMap, take, takeWhile, timer } from 'rxjs';
import {
  ApiService,
  type ImportBatchDetail,
  type ImportBatchHistoryItem,
  type ImportDiagnostic,
  type ImportJob,
  type UploadWorkbookKind,
} from './api.service';

type RequestState = 'idle' | 'loading' | 'loaded' | 'error';

@Component({
  selector: 'sportos-import-panel',
  standalone: true,
  imports: [FormsModule],
  outputs: ['reconcileDate'],
  template: `
    <section class="card import-card">
      <div class="section-heading">
        <div>
          <h2>Imports</h2>
          <p class="help">Upload a supported XLSX workbook, then follow its durable worker job, batch, affected dates, and row diagnostics.</p>
        </div>
        <button type="button" class="secondary" (click)="loadHistory()" [disabled]="historyState() === 'loading'">
          Refresh
        </button>
      </div>

      <section class="upload-panel" aria-labelledby="upload-heading">
        <div>
          <h3 id="upload-heading">Upload workbook</h3>
          <p class="privacy-note">Maximum 20 MB. Upload returns after queueing; a separate worker performs the import.</p>
        </div>
        <div class="upload-fields">
          <label>
            Workbook type
            <select [(ngModel)]="workbookKind" name="workbookKind" [disabled]="importState() === 'loading'">
              <option value="my_sport">Daily ledger (my_sport)</option>
              <option value="run_db">Running performance database</option>
            </select>
          </label>
          <label>
            XLSX file
            <input
              #fileInput
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              (change)="onFileSelected($event)"
              [disabled]="importState() === 'loading'">
          </label>
        </div>
        @if (selectedFilename()) {
          <p class="selected-file">Selected: <strong>{{ selectedFilename() }}</strong></p>
        }
        <button type="button" (click)="import(fileInput)" [disabled]="importState() === 'loading' || !selectedFile">
          {{ importState() === 'loading' ? 'Upload or import in progress…' : 'Upload and queue' }}
        </button>
        @if (uploadProgress() !== null && importState() === 'loading') {
          <div class="upload-progress" aria-live="polite">
            <progress [value]="uploadProgress()" max="100"></progress>
            <span>{{ uploadProgress() }}%</span>
          </div>
        }
        @if (activeJob(); as job) {
          <section class="job-card" aria-label="Current import job">
            <div class="job-heading">
              <div>
                <strong>{{ job.filename }}</strong>
                <p>Attempt {{ job.attemptCount }} of {{ job.maxAttempts }} · {{ job.phase }}</p>
              </div>
              <span [class]="'status status-' + job.status">{{ job.status }}</span>
            </div>
            <div class="job-progress">
              <progress [value]="job.progressPercent" max="100"></progress>
              <span>{{ job.progressPercent }}%</span>
            </div>
            @if (job.cancellationRequested && job.status === 'running') {
              <p class="privacy-note">Cancellation requested. The worker will roll back at the next safe phase boundary.</p>
            }
            <div class="job-actions">
              @if ((job.status === 'queued' || job.status === 'running') && !job.cancellationRequested) {
                <button type="button" class="secondary" (click)="cancelActiveJob()">Cancel job</button>
              }
              @if (job.status === 'failed' && job.attemptCount < job.maxAttempts) {
                <button type="button" class="secondary" (click)="retryActiveJob()">Retry job</button>
              }
            </div>
          </section>
        }
        @if (importMessage()) {
          <p class="request-message" [class.error-message]="importState() === 'error'" aria-live="polite">{{ importMessage() }}</p>
        }
        <p class="developer-note">Status polling stops on a terminal state or after 120 checks. The server-local CLI remains available for development.</p>
      </section>

      <div class="history-heading">
        <h3>Recent batches</h3>
        @if (historyState() === 'loaded') {
          <span>{{ history().length }} of {{ historyTotal() }}</span>
        }
      </div>

      @if (historyState() === 'loading') {
        <p class="state-message" aria-live="polite">Loading import history…</p>
      } @else if (historyState() === 'error') {
        <div class="state-message error-message" role="alert">
          <p>{{ historyError() }}</p>
          <button type="button" (click)="loadHistory()">Retry</button>
        </div>
      } @else if (history().length === 0) {
        <p class="state-message">No import batches have been recorded yet.</p>
      } @else {
        <ul class="batch-list" aria-label="Recent import batches">
          @for (batch of history(); track batch.id) {
            <li>
              <button
                type="button"
                class="batch-button"
                [class.selected]="selectedBatchId() === batch.id"
                (click)="selectBatch(batch)">
                <span class="batch-primary">
                  <strong>{{ batch.filename || batch.source }}</strong>
                  <span [class]="'status status-' + batch.status">{{ batch.status }}</span>
                </span>
                <span class="batch-secondary">{{ formatTimestamp(batch.startedAt) }}</span>
                <span class="batch-counts">
                  {{ batch.rowCount }} rows · {{ batch.normalizedCount }} normalized ·
                  {{ batch.warningCount }} warnings · {{ batch.errorCount }} errors
                </span>
              </button>
            </li>
          }
        </ul>
      }

      @if (detailState() === 'loading') {
        <p class="state-message" aria-live="polite">Loading batch details…</p>
      } @else if (detailState() === 'error') {
        <div class="state-message error-message" role="alert">
          <p>{{ detailError() }}</p>
          <button type="button" (click)="retryDetail()">Retry</button>
        </div>
      } @else {
        @if (detail(); as selected) {
          <section class="batch-detail" aria-label="Selected import batch details">
            <div class="detail-heading">
              <div>
                <h3>{{ selected.batch.filename || selected.batch.source }}</h3>
                <p>{{ selected.batch.source }} · {{ selected.batch.sourceKind }}</p>
              </div>
              <span [class]="'status status-' + selected.batch.status">{{ selected.batch.status }}</span>
            </div>

            <dl class="detail-counts">
              <div><dt>Rows</dt><dd>{{ selected.batch.rowCount }}</dd></div>
              <div><dt>Normalized</dt><dd>{{ selected.batch.normalizedCount }}</dd></div>
              <div><dt>Warnings</dt><dd>{{ selected.batch.warningCount }}</dd></div>
              <div><dt>Errors</dt><dd>{{ selected.batch.errorCount }}</dd></div>
            </dl>

            @if (selected.batch.failure) {
              <div class="failure-guidance" role="alert">
                <strong>Import failed during {{ selected.batch.failure.phase }}.</strong>
                <p>{{ selected.batch.failure.message }}</p>
                <p>Correct the workbook or retry its failed job. Every attempt remains inspectable.</p>
              </div>
            }

            <div class="detail-section">
              <h4>Affected dates</h4>
              @if (selected.batch.affectedDates.length === 0) {
                <p>No canonical dates were recorded for this batch.</p>
              } @else {
                <div class="date-links">
                  @for (date of selected.batch.affectedDates; track date) {
                    <a href="#daily-log" class="date-link" (click)="openReconciliation(date)">{{ date }} · reconcile</a>
                  }
                </div>
              }
            </div>

            <div class="detail-section">
              <h4>Status timeline</h4>
              <ol class="timeline">
                @for (transition of selected.transitions; track transition.recordedAt + transition.status) {
                  <li>
                    <strong>{{ transition.status }}</strong>
                    <span>{{ transition.phase }}</span>
                    <time>{{ formatTimestamp(transition.recordedAt) }}</time>
                  </li>
                }
              </ol>
            </div>

            <div class="detail-section">
              <div class="diagnostic-heading">
                <h4>Diagnostics</h4>
                <span>{{ selected.diagnostics.length }} of {{ selected.diagnosticTotal }}</span>
              </div>
              @if (selected.diagnostics.length === 0) {
                <p>No warnings or errors were recorded.</p>
              } @else {
                <ul class="diagnostic-list">
                  @for (diagnostic of selected.diagnostics; track diagnosticKey(diagnostic)) {
                    <li [class]="'diagnostic diagnostic-' + diagnostic.severity">
                      <div class="diagnostic-title">
                        <strong>{{ diagnostic.code }}</strong>
                        <span>{{ diagnostic.severity }}</span>
                      </div>
                      <p>{{ diagnostic.message }}</p>
                      <small>{{ diagnosticLocation(diagnostic) }} · {{ diagnostic.phase }}</small>
                    </li>
                  }
                </ul>
                @if (hasMoreDiagnostics()) {
                  <button type="button" class="secondary" (click)="loadMoreDiagnostics()" [disabled]="loadingMoreDiagnostics()">
                    {{ loadingMoreDiagnostics() ? 'Loading…' : 'Load more diagnostics' }}
                  </button>
                }
              }
            </div>
          </section>
        }
      }
    </section>
  `,
  styles: [`
    .import-card { display: grid; gap: 16px; }
    .section-heading, .history-heading, .detail-heading, .diagnostic-heading, .batch-primary, .job-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .section-heading h2, .history-heading h3, .detail-heading h3, .detail-section h4, .upload-panel h3 { margin-bottom: 4px; }
    .help, .privacy-note, .developer-note, .detail-heading p, .state-message, .batch-secondary, .batch-counts, .timeline span, .timeline time, .job-heading p {
      color: #667085;
      font-size: 13px;
    }
    .secondary { background: #e8eefc; color: #1d4ed8; }
    button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .6; }
    .upload-panel { display: grid; gap: 12px; border: 1px solid #dbe3f0; border-radius: 14px; padding: 14px; }
    .upload-fields { display: grid; grid-template-columns: minmax(180px, .8fr) minmax(220px, 1.4fr); gap: 12px; }
    .upload-fields label { display: grid; gap: 5px; font-size: 13px; font-weight: 650; }
    .upload-fields input, .upload-fields select { box-sizing: border-box; width: 100%; min-width: 0; }
    .selected-file, .request-message, .developer-note, .job-heading p { margin: 0; }
    .upload-progress, .job-progress { display: flex; align-items: center; gap: 10px; }
    .upload-progress progress, .job-progress progress { width: min(360px, 100%); }
    .job-card { display: grid; gap: 10px; padding: 12px; border-radius: 12px; background: #f8fafc; }
    .job-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .error-message { color: #991b1b; }
    .state-message { padding: 14px; border-radius: 12px; background: #f8fafc; }
    .batch-list, .diagnostic-list, .timeline { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .batch-button { width: 100%; text-align: left; background: #f8fafc; color: #172033; border: 1px solid transparent; }
    .batch-button.selected { border-color: #1d4ed8; background: #eef3ff; }
    .batch-primary { align-items: center; }
    .batch-secondary, .batch-counts { display: block; margin-top: 4px; }
    .status { display: inline-flex; padding: 3px 8px; border-radius: 999px; background: #e5e7eb; color: #344054; font-size: 11px; font-weight: 750; text-transform: uppercase; }
    .status-scored, .status-normalized, .status-succeeded { background: #dcfce7; color: #166534; }
    .status-failed, .status-cancelled { background: #fee2e2; color: #991b1b; }
    .status-started, .status-parsed, .status-queued, .status-running { background: #fef3c7; color: #92400e; }
    .batch-detail { display: grid; gap: 16px; padding-top: 16px; border-top: 1px solid #e4e7ec; }
    .detail-counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .detail-counts div { padding: 10px; border-radius: 12px; background: #f8fafc; }
    .detail-counts dt { color: #667085; font-size: 11px; }
    .detail-counts dd { margin: 3px 0 0; font-size: 20px; font-weight: 750; }
    .failure-guidance { padding: 12px; border-radius: 12px; background: #fef2f2; color: #7f1d1d; }
    .failure-guidance p { margin: 6px 0 0; }
    .date-links { display: flex; flex-wrap: wrap; gap: 7px; }
    .date-link { padding: 6px 9px; border-radius: 9px; background: #eef3ff; color: #1d4ed8; font-size: 12px; font-weight: 650; text-decoration: none; }
    .timeline li { display: grid; grid-template-columns: 90px 1fr; gap: 3px 8px; padding: 8px 0; border-bottom: 1px solid #eef2f6; }
    .timeline time { grid-column: 2; }
    .diagnostic { padding: 10px; border-left: 4px solid #d97706; border-radius: 10px; background: #fffbeb; }
    .diagnostic-error { border-color: #dc2626; background: #fef2f2; }
    .diagnostic-title { display: flex; justify-content: space-between; gap: 8px; }
    .diagnostic p { margin: 5px 0; font-size: 13px; }
    .diagnostic small { color: #667085; }
    @media (max-width: 620px) {
      .detail-counts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .section-heading { align-items: stretch; flex-direction: column; }
      .upload-fields { grid-template-columns: 1fr; }
    }
  `],
})
export class ImportPanelComponent implements OnInit, OnDestroy {
  readonly reconcileDate = new EventEmitter<string>();

  workbookKind: UploadWorkbookKind = 'my_sport';
  selectedFile: File | null = null;
  readonly selectedFilename = signal<string | null>(null);
  readonly uploadProgress = signal<number | null>(null);
  readonly activeJob = signal<ImportJob | null>(null);
  readonly historyState = signal<RequestState>('idle');
  readonly history = signal<ImportBatchHistoryItem[]>([]);
  readonly historyTotal = signal(0);
  readonly historyError = signal<string | null>(null);
  readonly selectedBatchId = signal<string | null>(null);
  readonly detailState = signal<RequestState>('idle');
  readonly detail = signal<ImportBatchDetail | null>(null);
  readonly detailError = signal<string | null>(null);
  readonly loadingMoreDiagnostics = signal(false);
  readonly importState = signal<RequestState>('idle');
  readonly importMessage = signal<string | null>(null);
  readonly hasMoreDiagnostics = computed(() => {
    const detail = this.detail();
    return detail !== null && detail.diagnostics.length < detail.diagnosticTotal;
  });

  private historySubscription?: Subscription;
  private detailSubscription?: Subscription;
  private importSubscription?: Subscription;
  private jobSubscription?: Subscription;

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.historySubscription?.unsubscribe();
    this.detailSubscription?.unsubscribe();
    this.importSubscription?.unsubscribe();
    this.jobSubscription?.unsubscribe();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.item(0) ?? null;
    this.selectedFile = file;
    this.selectedFilename.set(file?.name ?? null);
    this.importMessage.set(null);
    if (!this.isActive(this.activeJob())) this.importState.set('idle');
    this.uploadProgress.set(null);
  }

  import(fileInput?: HTMLInputElement): void {
    const file = this.selectedFile;
    if (!file) {
      this.importState.set('error');
      this.importMessage.set('Choose an XLSX workbook before starting the import.');
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
        this.activeJob.set(response.job);
        this.uploadProgress.set(response.job.progressPercent);
        this.importMessage.set(`Uploaded ${response.upload.filename}. Job queued for the import worker.`);
        this.monitorJob(response.job.id);
      },
      error: (error: unknown) => {
        this.clearSelectedFile(fileInput);
        this.uploadProgress.set(null);
        this.importState.set('error');
        this.importMessage.set(this.describeUploadError(error));
        this.loadHistory();
      },
    });
  }

  cancelActiveJob(): void {
    const job = this.activeJob();
    if (!job || !this.isActive(job)) return;
    this.api.cancelImportJob(job.id).subscribe({
      next: (updated) => {
        this.activeJob.set(updated);
        if (this.isTerminal(updated)) this.handleTerminalJob(updated);
        else this.importMessage.set('Cancellation requested. Waiting for the worker to reach a safe phase boundary.');
      },
      error: (error: unknown) => {
        this.importState.set('error');
        this.importMessage.set(this.describeRequestError(error, 'The import job could not be cancelled.'));
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
        this.uploadProgress.set(updated.progressPercent);
        this.monitorJob(updated.id);
      },
      error: (error: unknown) => {
        this.importState.set('error');
        this.importMessage.set(this.describeRequestError(error, 'The import job could not be retried.'));
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
        this.historyError.set(this.describeRequestError(error, 'Import history could not be loaded.'));
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

  formatTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
  }

  diagnosticLocation(diagnostic: ImportDiagnostic): string {
    if (diagnostic.sheetName && diagnostic.rowIndex) return `${diagnostic.sheetName} row ${diagnostic.rowIndex}`;
    if (diagnostic.sheetName) return diagnostic.sheetName;
    return 'Batch-level diagnostic';
  }

  diagnosticKey(diagnostic: ImportDiagnostic): string {
    return [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.message,
      diagnostic.sheetName ?? '',
      diagnostic.rowIndex ?? '',
      diagnostic.recordedAt ?? '',
    ].join('|');
  }

  private monitorJob(jobId: string): void {
    this.jobSubscription?.unsubscribe();
    let terminalSeen = false;
    this.jobSubscription = timer(0, 1500).pipe(
      take(120),
      switchMap(() => this.api.importJob(jobId)),
      takeWhile((job) => !this.isTerminal(job), true),
    ).subscribe({
      next: (job) => {
        this.activeJob.set(job);
        this.uploadProgress.set(job.progressPercent);
        if (this.isTerminal(job)) {
          terminalSeen = true;
          this.handleTerminalJob(job);
        } else {
          this.importState.set('loading');
          this.importMessage.set(`Import job is ${job.status}: ${job.phase}.`);
        }
      },
      error: (error: unknown) => {
        this.importState.set('error');
        this.importMessage.set(this.describeRequestError(error, 'Import job status could not be loaded.'));
      },
      complete: () => {
        if (!terminalSeen && this.isActive(this.activeJob())) {
          this.importState.set('loaded');
          this.importMessage.set('The job is still active. Automatic polling stopped after 120 checks; reload the page or review history later.');
        }
      },
    });
  }

  private handleTerminalJob(job: ImportJob): void {
    this.uploadProgress.set(job.progressPercent);
    this.loadHistory();
    if (job.status === 'succeeded') {
      this.importState.set('loaded');
      this.importMessage.set(this.successMessage(job));
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

  private successMessage(job: ImportJob): string {
    const result = job.result && typeof job.result === 'object' ? job.result as Record<string, unknown> : {};
    const dailyRows = safeCount(result.dailyRows);
    const activities = safeCount(result.activities);
    const performanceEvents = safeCount(result.performanceEvents);
    const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0;
    return `Import completed: ${dailyRows} daily rows, ${activities} activities, ${performanceEvents} performance events, and ${warnings} warnings.`;
  }

  private isActive(job: ImportJob | null): boolean {
    return job?.status === 'queued' || job?.status === 'running';
  }

  private isTerminal(job: ImportJob): boolean {
    return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
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
        this.detailError.set(this.describeRequestError(error, 'Batch details could not be loaded.'));
        this.detailState.set('error');
      },
    });
  }

  private describeUploadError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The workbook upload failed. Try again.';
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    if (error.status === 413) return 'The workbook exceeds the 20 MB upload limit.';

    const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {};
    const code = typeof body.code === 'string' ? body.code : '';
    if (code === 'DUPLICATE_UPLOAD') {
      const duplicate = body.duplicate && typeof body.duplicate === 'object'
        ? body.duplicate as Record<string, unknown>
        : {};
      const filename = typeof duplicate.filename === 'string' ? duplicate.filename : 'This workbook';
      const status = typeof duplicate.batchStatus === 'string' ? ` Its batch is ${duplicate.batchStatus}.` : '';
      return `${filename} was already uploaded.${status} Select the existing batch in history instead of importing it again.`;
    }
    if (code === 'IMPORT_QUEUE_FULL') return 'The import queue is full. Wait for an active job to finish, then upload again.';
    if (code === 'UPLOAD_STORAGE_FAILED') return 'The workbook could not be stored. No import job was created.';
    if (code === 'IMPORT_JOB_ENQUEUE_FAILED') return 'The workbook was not queued. No import was started.';
    const actionableCodes = new Set([
      'UPLOAD_FILE_REQUIRED',
      'INVALID_WORKBOOK_KIND',
      'UNSUPPORTED_FILE_EXTENSION',
      'UNSUPPORTED_MEDIA_TYPE',
      'EMPTY_UPLOAD',
      'UPLOAD_TOO_LARGE',
      'INVALID_XLSX',
    ]);
    if (actionableCodes.has(code) && typeof body.message === 'string') return body.message;
    return `The workbook upload failed. The API returned HTTP ${error.status}.`;
  }

  private describeRequestError(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) return fallback;
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API and worker are running.';
    if (error.status === 404) return 'The selected import job or batch no longer exists.';
    const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {};
    return typeof body.message === 'string' ? body.message : `${fallback} The API returned HTTP ${error.status}.`;
  }
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
