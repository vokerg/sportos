import { Component, input, output } from '@angular/core';
import type { ImportBatchHistoryItem } from './features/imports/model/imports.models';
import { formatDateTime } from './date-time';
import type { ImportRequestState } from './import-workflow.view-model';

@Component({
  selector: 'sportos-import-history',
  standalone: true,
  template: `
    <div class="history-heading">
      <div>
        <h3>Recent batches</h3>
        @if (state() === 'loaded') {
          <span>{{ items().length }} of {{ total() }}</span>
        }
      </div>
      <button type="button" class="secondary" (click)="refreshRequested.emit()" [disabled]="state() === 'loading'">
        Refresh
      </button>
    </div>

    @if (state() === 'loading') {
      <p class="state-message" aria-live="polite">Loading import history…</p>
    } @else if (state() === 'error') {
      <div class="state-message error-message" role="alert">
        <p>{{ errorMessage() }}</p>
        <button type="button" (click)="refreshRequested.emit()">Retry</button>
      </div>
    } @else if (items().length === 0) {
      <p class="state-message">No import batches have been recorded yet.</p>
    } @else {
      <ul class="batch-list" aria-label="Recent import batches">
        @for (batch of items(); track batch.id) {
          <li>
            <button
              type="button"
              class="batch-button"
              [class.selected]="selectedBatchId() === batch.id"
              (click)="batchSelected.emit(batch)">
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
  `,
  styles: [`
    .history-heading, .batch-primary { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .history-heading > div { display: grid; gap: 4px; }
    .history-heading h3 { margin: 0; }
    .history-heading span, .state-message, .batch-secondary, .batch-counts { color: #667085; font-size: 13px; }
    .secondary { background: #e8eefc; color: #1d4ed8; }
    .state-message { padding: 14px; border-radius: 12px; background: #f8fafc; }
    .state-message p { margin-top: 0; }
    .error-message { color: #991b1b; }
    .batch-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .batch-button { width: 100%; text-align: left; background: #f8fafc; color: #172033; border: 1px solid transparent; }
    .batch-button.selected { border-color: #1d4ed8; background: #eef3ff; }
    .batch-primary { align-items: center; }
    .batch-secondary, .batch-counts { display: block; margin-top: 4px; }
    .status { display: inline-flex; padding: 3px 8px; border-radius: 999px; background: #e5e7eb; color: #344054; font-size: 11px; font-weight: 750; text-transform: uppercase; }
    .status-scored, .status-normalized { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .status-started, .status-parsed { background: #fef3c7; color: #92400e; }
  `],
})
export class ImportHistoryComponent {
  readonly state = input<ImportRequestState>('idle');
  readonly items = input<ImportBatchHistoryItem[]>([]);
  readonly total = input(0);
  readonly errorMessage = input<string | null>(null);
  readonly selectedBatchId = input<string | null>(null);

  readonly refreshRequested = output<void>();
  readonly batchSelected = output<ImportBatchHistoryItem>();

  formatTimestamp(value: string): string {
    return formatDateTime(value);
  }
}
