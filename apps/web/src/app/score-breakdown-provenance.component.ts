import { Component, input } from '@angular/core';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import {
  hasWorkbookCells,
  jsonLabel,
  rawValueLabel,
  sourceName,
  sourceRecordTitle,
  sourceSummary,
  workbookCells,
  workbookHeader,
} from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-provenance',
  standalone: true,
  template: `
    @let current = breakdown();
    <div class="source-card">
      <span class="source-icon" aria-hidden="true">↗</span>
      <div class="source-copy">
        <span class="section-label">Source</span>
        <strong>{{ sourceSummary(current.sourceRecord) }}</strong>
      </div>
      @if (current.sourceRecord) {
        <details class="quiet-details">
          <summary>View details</summary>
          <dl>
            <dt>Batch</dt><dd>{{ current.sourceRecord.batch.id }}</dd>
            <dt>Workbook</dt><dd>{{ current.sourceRecord.batch.filename || current.sourceRecord.batch.source }}</dd>
            <dt>File hash</dt><dd class="hash">{{ current.sourceRecord.batch.originalSha256 || 'Unavailable' }}</dd>
            <dt>Row hash</dt><dd class="hash">{{ current.sourceRecord.rowHash }}</dd>
          </dl>
        </details>
      }
    </div>

    <section class="data-section" aria-labelledby="day-source-title">
      <div class="section-heading">
        <div>
          <span class="section-label">Raw provenance</span>
          <h4 id="day-source-title">Every source record for this day</h4>
          <p class="section-help">This is the unabridged source payload behind the daily row and the imported provider activities.</p>
        </div>
        <strong class="count-badge">{{ current.sourceRecords.length }}</strong>
      </div>
      @if (current.sourceRecords.length === 0) {
        <div class="empty-inline">No source records are linked to this date.</div>
      } @else {
        <div class="source-record-list">
          @for (record of current.sourceRecords; track record.id) {
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
    .source-card { display: flex; align-items: center; justify-content: flex-start; gap: 16px; margin: 14px 0 22px; padding: 12px 14px; border: 1px solid #e1e7f0; border-radius: 12px; background: rgba(255, 255, 255, .72); }
    .source-icon { display: grid; flex: 0 0 auto; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #e9edff; color: #5368ae; font-weight: 800; }
    .source-copy { min-width: 0; flex: 1; }
    .source-copy strong { display: block; margin-top: 3px; color: #344054; font-size: 13px; }
    .section-label { color: #667085; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .data-section { margin: 22px 0; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
    .section-heading h4 { margin: 3px 0 0; color: #172b4d; font-size: 17px; }
    .section-help { max-width: 760px; margin: 5px 0 0; color: #667085; font-size: 12px; line-height: 1.45; }
    .count-badge { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: #eef3ff; color: #40558f; font-size: 12px; }
    .empty-inline { padding: 14px; border: 1px dashed #c7d2e5; border-radius: 10px; color: #667085; background: #fff; }
    .source-record-list { display: grid; gap: 8px; }
    .source-record { border: 1px solid #e1e7f0; border-radius: 10px; background: #fff; }
    .source-record summary { display: flex; align-items: center; gap: 9px; padding: 11px 12px; list-style: none; }
    .source-record summary::-webkit-details-marker { display: none; }
    .source-record summary::before { content: '›'; color: #667085; font-size: 17px; transition: transform .15s ease; }
    .source-record[open] summary::before { transform: rotate(90deg); }
    .source-record summary strong { min-width: 0; color: #344054; overflow-wrap: anywhere; }
    .source-record-meta { margin-left: auto; color: #667085; font-size: 11px; white-space: nowrap; }
    .source-record-body { padding: 0 12px 12px; }
    .source-meta, dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 5px 12px; margin: 0 0 10px; font-size: 11px; }
    .source-meta dt, dt { color: #667085; }
    .source-meta dd, dd { margin: 0; overflow-wrap: anywhere; }
    .mono, .hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .raw-table-wrap { overflow-x: auto; border: 1px solid #e1e7f0; border-radius: 10px; background: #fff; }
    .raw-cell-table { width: 100%; min-width: 520px; border-collapse: collapse; font-size: 12px; }
    .raw-cell-table th, .raw-cell-table td { padding: 10px 11px; border-bottom: 1px solid #edf0f5; text-align: left; vertical-align: top; }
    .raw-cell-table thead th { color: #667085; background: #f8fafc; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; white-space: nowrap; }
    .raw-cell-table tbody tr:last-child th, .raw-cell-table tbody tr:last-child td { border-bottom: 0; }
    .raw-cell-table th:first-child { width: 260px; }
    .raw-cell-table tbody th { color: #667085; font-weight: 650; background: #fbfcfe; }
    .raw-cell-table td { max-width: 680px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .raw-json { max-height: 420px; margin: 0; padding: 12px; overflow: auto; border-radius: 8px; background: #111827; color: #e5e7eb; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .source-badge { display: inline-block; padding: 4px 7px; border-radius: 999px; background: #eef3ff; color: #40558f; font-size: 10px; font-weight: 800; white-space: nowrap; }
    .source-badge[data-source='strava'] { background: #fff0e8; color: #b54708; }
    .source-badge[data-source='my_sport_xlsx'] { background: #eaf7ee; color: #13795b; }
    details { margin-top: 6px; }
    summary { cursor: pointer; color: #5267a8; font-size: 12px; font-weight: 700; }
    summary:focus-visible { outline: 3px solid #a8b9ef; outline-offset: 3px; border-radius: 4px; }
    .quiet-details dl { margin-top: 8px; }
    @media (max-width: 680px) {
      .section-heading { flex-direction: column; }
      .source-record-meta { margin-left: 0; }
    }
  `],
})
export class ScoreBreakdownProvenanceComponent {
  readonly breakdown = input.required<DailyScoreBreakdown>();

  readonly hasWorkbookCells = hasWorkbookCells;
  readonly jsonLabel = jsonLabel;
  readonly rawValueLabel = rawValueLabel;
  readonly sourceName = sourceName;
  readonly sourceRecordTitle = sourceRecordTitle;
  readonly sourceSummary = sourceSummary;
  readonly workbookCells = workbookCells;
  readonly workbookHeader = workbookHeader;
}
