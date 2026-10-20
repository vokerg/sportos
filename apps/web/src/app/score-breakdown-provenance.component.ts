import { Component, input } from '@angular/core';
import type { DailyScoreBreakdown, SourceRecordReference } from './score-breakdown.models';
import {
  hasWorkbookCells,
  jsonLabel,
  rawValueLabel,
  sourceName,
  sourceRecordTitle,
  workbookCells,
  workbookHeader,
} from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-provenance',
  standalone: true,
  template: `
    @let records = visibleSourceRecords();
    <section class="data-section" aria-labelledby="day-source-title">
      <div class="section-heading">
        <div>
          <span class="section-label">Raw provenance</span>
          <h4 id="day-source-title">Workbook, manual and Strava records</h4>
          <p class="section-help">Garmin Connect records are retained separately and can be inspected in the Garmin section below. Garmin CSV records appear here.</p>
        </div>
        <strong class="count-badge">{{ records.length }}</strong>
      </div>
      @if (records.length === 0) {
        <div class="empty-inline">No source records are linked to this date.</div>
      } @else {
        <div class="source-record-list">
          @for (record of records; track record.id) {
            <details class="source-record">
              <summary>
                <span class="source-badge" [attr.data-source]="record.batch.source">{{ sourceName(record.batch.source) }}</span>
                <strong>{{ sourceRecordTitle(record) }}</strong>
                <span class="source-record-meta">{{ record.status }} · {{ record.normalizedEntityType || 'raw only' }}</span>
              </summary>
              <div class="source-record-body">
                <dl class="source-meta">
                  <dt>Batch</dt><dd>{{ record.batch.filename || record.batch.source }} · {{ record.batch.status }}</dd>
                  <dt>Location</dt><dd>{{ record.sheetName || 'Provider payload' }}{{ record.rowIndex === null ? '' : ' · row ' + record.rowIndex }}</dd>
                  <dt>Record key</dt><dd class="mono">{{ record.normalizedEntityId || record.id }}</dd>
                </dl>
                @if (hasWorkbookCells(record.rawJson)) {
                  <div class="raw-table-wrap">
                    <table class="raw-cell-table">
                      <thead><tr><th>Column</th><th>Raw value</th></tr></thead>
                      <tbody>
                        @for (cell of workbookCells(record.rawJson); track $index) {
                          <tr><th>{{ workbookHeader(record.rawJson, $index) }}</th><td>{{ rawValueLabel(cell) }}</td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <pre class="raw-json">{{ jsonLabel(record.rawJson) }}</pre>
                }
              </div>
            </details>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .data-section { margin: 22px 0; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .section-heading h4 { margin: 3px 0 0; color: var(--text); font-size: 17px; }
    .section-label { color: var(--text-muted); font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .section-help { max-width: 760px; margin: 5px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
    .count-badge { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: var(--accent-surface); color: var(--link); font-size: 12px; }
    .empty-inline { padding: 14px; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-muted); background: var(--surface); }
    .source-record-list { display: grid; gap: 8px; }
    .source-record { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
    .source-record summary { display: flex; align-items: center; gap: 9px; padding: 11px 12px; list-style: none; }
    .source-record summary::-webkit-details-marker { display: none; }
    .source-record summary::before { content: '›'; color: var(--text-muted); font-size: 17px; transition: transform .15s ease; }
    .source-record[open] summary::before { transform: rotate(90deg); }
    .source-record summary strong { min-width: 0; color: var(--text-secondary); overflow-wrap: anywhere; }
    .source-record-meta { margin-left: auto; color: var(--text-muted); font-size: 11px; white-space: nowrap; }
    .source-record-body { padding: 0 12px 12px; }
    .source-meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 12px; margin: 0 0 10px; font-size: 11px; }
    .source-meta dt { color: var(--text-muted); }
    .source-meta dd { margin: 0; overflow-wrap: anywhere; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .raw-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
    .raw-cell-table { width: 100%; min-width: 520px; border-collapse: collapse; font-size: 12px; }
    .raw-cell-table th, .raw-cell-table td { padding: 10px 11px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
    .raw-cell-table thead th { color: var(--text-muted); background: var(--accent-surface); font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
    .raw-cell-table tbody tr:last-child th, .raw-cell-table tbody tr:last-child td { border-bottom: 0; }
    .raw-cell-table th:first-child { width: 260px; }
    .raw-cell-table tbody th { color: var(--text-muted); font-weight: 650; background: var(--accent-surface); }
    .raw-cell-table td { max-width: 680px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .raw-json { max-height: 420px; margin: 0; padding: 12px; overflow: auto; border-radius: 8px; background: var(--primary); color: var(--surface-muted); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .source-badge { display: inline-block; padding: 4px 7px; border-radius: 999px; background: var(--accent-surface); color: var(--link); font-size: 10px; font-weight: 800; white-space: nowrap; }
    .source-badge[data-source='strava'] { background: var(--warning-surface); color: var(--warning); }
    .source-badge[data-source='my_sport_xlsx'] { background: var(--success-surface); color: var(--success); }
    .source-badge[data-source='garmin_csv'] { background: var(--accent-surface); color: var(--link); }
    details { margin-top: 6px; }
    summary { cursor: pointer; color: var(--link); font-size: 12px; font-weight: 700; }
    summary:focus-visible { outline: 3px solid var(--accent-surface); outline-offset: 3px; border-radius: 4px; }
    @media (max-width: 680px) {
      .section-heading { flex-direction: column; }
      .source-record-meta { margin-left: 0; }
    }
  `],
})
export class ScoreBreakdownProvenanceComponent {
  readonly breakdown = input<DailyScoreBreakdown | null>(null);
  readonly sourceRecords = input<SourceRecordReference[] | null>(null);

  readonly hasWorkbookCells = hasWorkbookCells;
  readonly jsonLabel = jsonLabel;
  readonly rawValueLabel = rawValueLabel;
  readonly sourceName = sourceName;
  readonly sourceRecordTitle = sourceRecordTitle;
  readonly workbookCells = workbookCells;
  readonly workbookHeader = workbookHeader;

  visibleSourceRecords(): SourceRecordReference[] {
    return this.sourceRecords() ?? this.breakdown()?.sourceRecords ?? [];
  }
}
