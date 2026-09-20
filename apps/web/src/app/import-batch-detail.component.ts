import { Component, input, output } from '@angular/core';
import type { ImportBatchDetail } from './features/imports/model/imports.models';
import { formatDate, formatDateTime } from './date-time';
import { ImportDiagnosticsComponent } from './import-diagnostics.component';
import type { ImportRequestState } from './import-workflow.view-model';

@Component({
  selector: 'sportos-import-batch-detail',
  standalone: true,
  imports: [ImportDiagnosticsComponent],
  template: `
    @if (state() === 'loading') {
      <p class="state-message" aria-live="polite">Loading batch details…</p>
    } @else if (state() === 'error') {
      <div class="state-message error-message" role="alert">
        <p>{{ errorMessage() }}</p>
        <button type="button" (click)="retryRequested.emit()">Retry</button>
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
                  <button type="button" class="date-link" (click)="reconcileDate.emit(date)">
                    {{ formatDateValue(date) }} · reconcile
                  </button>
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
            <sportos-import-diagnostics
              [diagnostics]="selected.diagnostics"
              [total]="selected.diagnosticTotal"
              [hasMore]="selected.diagnostics.length < selected.diagnosticTotal"
              [loadingMore]="loadingMoreDiagnostics()"
              (loadMoreRequested)="loadMoreDiagnosticsRequested.emit()" />
          </div>
        </section>
      }
    }
  `,
  styles: [`
    .state-message { padding: 14px; border-radius: 12px; background: #f8fafc; color: #667085; font-size: 13px; }
    .state-message p { margin-top: 0; }
    .error-message { color: #991b1b; }
    .batch-detail { display: grid; gap: 16px; padding-top: 16px; border-top: 1px solid #e4e7ec; }
    .detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .detail-heading h3, .detail-section h4 { margin-bottom: 4px; }
    .detail-heading p { color: #667085; font-size: 13px; }
    .detail-counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; }
    .detail-counts div { padding: 10px; border-radius: 12px; background: #f8fafc; }
    .detail-counts dt { color: #667085; font-size: 11px; }
    .detail-counts dd { margin: 3px 0 0; font-size: 20px; font-weight: 750; }
    .failure-guidance { padding: 12px; border-radius: 12px; background: #fef2f2; color: #7f1d1d; }
    .failure-guidance p { margin: 6px 0 0; }
    .date-links { display: flex; flex-wrap: wrap; gap: 7px; }
    .date-link { padding: 6px 9px; border: 0; border-radius: 9px; background: #eef3ff; color: #1d4ed8; font-size: 12px; font-weight: 650; text-decoration: none; }
    .timeline { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .timeline li { display: grid; grid-template-columns: 90px 1fr; gap: 3px 8px; padding: 8px 0; border-bottom: 1px solid #eef2f6; }
    .timeline span, .timeline time { color: #667085; font-size: 13px; }
    .timeline time { grid-column: 2; }
    .status { display: inline-flex; padding: 3px 8px; border-radius: 999px; background: #e5e7eb; color: #344054; font-size: 11px; font-weight: 750; text-transform: uppercase; }
    .status-scored, .status-normalized { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .status-started, .status-parsed { background: #fef3c7; color: #92400e; }
    @media (max-width: 620px) { .detail-counts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `],
})
export class ImportBatchDetailComponent {
  readonly state = input<ImportRequestState>('idle');
  readonly detail = input<ImportBatchDetail | null>(null);
  readonly errorMessage = input<string | null>(null);
  readonly loadingMoreDiagnostics = input(false);

  readonly retryRequested = output<void>();
  readonly reconcileDate = output<string>();
  readonly loadMoreDiagnosticsRequested = output<void>();

  formatTimestamp(value: string): string {
    return formatDateTime(value);
  }

  formatDateValue(value: string): string {
    return formatDate(value);
  }
}
