import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  ApiService,
  type ImportBatchDetail,
  type ImportBatchHistoryItem,
  type ImportDiagnostic,
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
          <p class="help">Run the development-only local import, then inspect durable batches and row diagnostics without exposing raw cells or server paths.</p>
        </div>
        <button type="button" class="secondary" (click)="loadHistory()" [disabled]="historyState() === 'loading'">
          Refresh
        </button>
      </div>

      <details class="local-import">
        <summary>Import server-local XLSX files</summary>
        <p class="privacy-note">Paths are obscured while entered and are never shown in history or diagnostic responses.</p>
        <div class="path-fields">
          <label>
            Daily ledger path
            <input
              type="password"
              [(ngModel)]="mySportPath"
              autocomplete="off"
              spellcheck="false"
              placeholder="Server-local path">
          </label>
          <label>
            Running database path
            <input
              type="password"
              [(ngModel)]="runDbPath"
              autocomplete="off"
              spellcheck="false"
              placeholder="Server-local path">
          </label>
        </div>
        <button type="button" (click)="import()" [disabled]="importState() === 'loading'">
          {{ importState() === 'loading' ? 'Importing…' : 'Import files' }}
        </button>
        @if (importMessage()) {
          <p class="request-message" [class.error-message]="importState() === 'error'" aria-live="polite">{{ importMessage() }}</p>
        }
      </details>

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
      } @else if (detail(); as selected) {
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
              <p>Correct the workbook or local access problem, then run the import again. A retry creates a new inspectable batch.</p>
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
    </section>
  `,
  styles: [`
    .import-card { display: grid; gap: 16px; }
    .section-heading, .history-heading, .detail-heading, .diagnostic-heading, .batch-primary {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .section-heading h2, .history-heading h3, .detail-heading h3, .detail-section h4 { margin-bottom: 4px; }
    .help, .privacy-note, .detail-heading p, .state-message, .batch-secondary, .batch-counts, .timeline span, .timeline time {
      color: #667085;
      font-size: 13px;
    }
    .secondary { background: #e8eefc; color: #1d4ed8; }
    button:disabled { cursor: not-allowed; opacity: .6; }
    .local-import { border: 1px solid #dbe3f0; border-radius: 14px; padding: 12px; }
    .local-import summary { cursor: pointer; font-weight: 700; }
    .path-fields { display: grid; gap: 10px; margin: 12px 0; }
    .path-fields label { display: grid; gap: 5px; font-size: 13px; font-weight: 650; }
    .path-fields input { box-sizing: border-box; width: 100%; min-width: 0; }
    .request-message { margin: 10px 0 0; }
    .error-message { color: #991b1b; }
    .state-message { padding: 14px; border-radius: 12px; background: #f8fafc; }
    .batch-list, .diagnostic-list, .timeline { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .batch-button { width: 100%; text-align: left; background: #f8fafc; color: #172033; border: 1px solid transparent; }
    .batch-button.selected { border-color: #1d4ed8; background: #eef3ff; }
    .batch-primary { align-items: center; }
    .batch-secondary, .batch-counts { display: block; margin-top: 4px; }
    .status { display: inline-flex; padding: 3px 8px; border-radius: 999px; background: #e5e7eb; color: #344054; font-size: 11px; font-weight: 750; text-transform: uppercase; }
    .status-scored, .status-normalized { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .status-started, .status-parsed { background: #fef3c7; color: #92400e; }
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
    }
  `],
})
export class ImportPanelComponent implements OnInit, OnDestroy {
  readonly reconcileDate = new EventEmitter<string>();

  mySportPath = '';
  runDbPath = '';

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

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.historySubscription?.unsubscribe();
    this.detailSubscription?.unsubscribe();
    this.importSubscription?.unsubscribe();
  }

  import(): void {
    if (!this.mySportPath.trim() && !this.runDbPath.trim()) {
      this.importState.set('error');
      this.importMessage.set('Enter at least one server-local workbook path.');
      return;
    }

    this.importSubscription?.unsubscribe();
    this.importState.set('loading');
    this.importMessage.set(null);
    this.importSubscription = this.api
      .importLocalFiles(this.mySportPath.trim() || undefined, this.runDbPath.trim() || undefined)
      .subscribe({
        next: (result) => {
          this.mySportPath = '';
          this.runDbPath = '';
          this.importState.set('loaded');
          this.importMessage.set(
            `Import recorded ${result.dailyRows} daily rows, ${result.activities} activities, ${result.performanceEvents} performance events, and ${result.warnings.length} warnings.`,
          );
          this.loadHistory();
          const latestBatch = result.batches.at(-1);
          if (latestBatch) this.loadDetail(latestBatch.id);
        },
        error: () => {
          this.mySportPath = '';
          this.runDbPath = '';
          this.importState.set('error');
          this.importMessage.set('The import failed. Review the newest failed batch for its phase and diagnostics.');
          this.loadHistory();
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

  private describeRequestError(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) return fallback;
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    if (error.status === 404) return 'The selected import batch no longer exists.';
    return `${fallback} The API returned HTTP ${error.status}.`;
  }
}
