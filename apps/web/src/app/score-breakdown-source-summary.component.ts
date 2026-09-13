import { Component, input } from '@angular/core';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import { sourceSummary } from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-source-summary',
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
  `,
  styles: [`
    .source-card { display: flex; align-items: center; justify-content: flex-start; gap: 16px; margin: 14px 0 22px; padding: 12px 14px; border: 1px solid #e1e7f0; border-radius: 12px; background: rgba(255, 255, 255, .72); }
    .source-icon { display: grid; flex: 0 0 auto; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #e9edff; color: #5368ae; font-weight: 800; }
    .source-copy { min-width: 0; flex: 1; }
    .source-copy strong { display: block; margin-top: 3px; color: #344054; font-size: 13px; }
    .section-label { color: #667085; font-size: 11px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    details { margin-top: 6px; }
    summary { cursor: pointer; color: #5267a8; font-size: 12px; font-weight: 700; }
    summary:focus-visible { outline: 3px solid #a8b9ef; outline-offset: 3px; border-radius: 4px; }
    dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 8px 0 0; font-size: 11px; }
    dt { color: #667085; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  `],
})
export class ScoreBreakdownSourceSummaryComponent {
  readonly breakdown = input.required<DailyScoreBreakdown>();
  readonly sourceSummary = sourceSummary;
}
