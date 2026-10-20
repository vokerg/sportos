import { Component, input, output } from '@angular/core';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import {
  deltaDescription,
  deltaKind,
  deltaValue,
  formatNumber,
  formatSigned,
  ledgerMatchesAppTotal,
  ledgerSum,
  scoreAuthorityNote,
  scoreStatusLabel,
} from './score-breakdown.view-model';

@Component({
  selector: 'sportos-score-breakdown-summary',
  standalone: true,
  template: `
    @let current = breakdown();
    <div class="score-overview" aria-label="Score summary">
      <div class="total-card">
        <span class="metric-label">Total score</span>
        <strong>{{ formatNumber(current.score.appTotal) }}</strong>
        <span class="status-badge" [attr.data-status]="current.scoreStatus">{{ scoreStatusLabel(current.scoreStatus) }}</span>
        
        @if (detailed()) { <span class="total-note">{{ scoreAuthorityNote(current.scoreStatus) }}</span> }
        @if (showActions()) {
        <button type="button" class="secondary-button recalculation-action" (click)="recalculate.emit()" [disabled]="recalculating()">
          {{ recalculating() ? 'Recalculating…' : 'Recalculate from activities' }}
        </button>
        @if (recalculationError()) {
          <span class="recalculation-error" role="alert">{{ recalculationError() }}</span>
        }
        }
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-label">{{ current.scoreStatus === 'imported' ? 'Imported ledger total' : 'Base' }}</span>
          <strong>{{ formatNumber(current.score.baseTotal) }}</strong>
        </div>
        <div class="metric-card">
          <span class="metric-label">{{ current.scoreStatus === 'imported' ? 'Calculated bonus' : 'Bonus' }}</span>
          <strong class="positive-points">{{ current.scoreStatus === 'imported' ? 'Not applied' : formatSigned(current.score.bonusPoints) }}</strong>
        </div>

        @if (detailed()) {
          <div class="metric-card delta-card" [attr.data-delta]="deltaKind(current.score.delta)">
            <span class="metric-label">Compared with Excel</span>
            <strong>{{ deltaValue(current.score.delta) }}</strong>
            <small>{{ deltaDescription(current.score.delta) }}</small>
          </div>
        }
      </div>
    </div>

    @if (detailed() || !ledgerMatchesAppTotal(current)) {
    <div class="consistency-row" [class.consistency-warning]="!ledgerMatchesAppTotal(current)">
      <span class="consistency-icon" aria-hidden="true">{{ ledgerMatchesAppTotal(current) ? '✓' : '!' }}</span>
      <div>
        <strong>{{ ledgerMatchesAppTotal(current) ? 'Everything adds up' : 'Review the score details' }}</strong>
        <span>Ledger total: {{ formatNumber(ledgerSum(current)) }} · {{ ledgerMatchesAppTotal(current) ? 'matches' : 'does not match' }} the app total.</span>
      </div>
    </div>
    }
  `,
  styles: [`
    .score-overview {
      display: grid;
      grid-template-columns: minmax(170px, .75fr) minmax(0, 1.8fr);
      gap: 12px;
      margin: 20px 0 12px;
    }
    .total-card {
      display: flex;
      min-height: 130px;
      flex-direction: column;
      justify-content: center;
      padding: 18px;
      border: 1px solid var(--border-accent);
      border-radius: 14px;
      background: linear-gradient(145deg, var(--accent-surface), var(--surface));
    }
    .total-card > strong {
      margin: 4px 0 2px;
      color: var(--link);
      font-size: 38px;
      font-weight: 750;
      letter-spacing: -.04em;
    }
    .metric-label {
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .status-badge { align-self: flex-start; padding: 4px 8px; border-radius: 999px; background: var(--success-surface); color: var(--success); font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
    .status-badge[data-status='calculated'] { background: var(--accent-surface); color: var(--link); }
    .status-badge[data-status='manual'] { background: var(--warning-surface); color: var(--warning); }
    .total-note, .metric-card small { color: var(--text-muted); font-size: 12px; }
    .secondary-button { background: var(--surface); color: var(--link); border: 1px solid var(--border-accent); box-shadow: none; }
    .recalculation-action { align-self: flex-start; margin-top: 10px; font-size: 12px; }
    .recalculation-error { margin-top: 6px; color: var(--danger); font-size: 12px; }
    .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .metric-card {
      display: flex;
      min-height: 96px;
      flex-direction: column;
      justify-content: center;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface-glass);
    }
    .metric-card strong { margin-top: 6px; color: var(--text); font-size: 23px; }
    .delta-card[data-delta='positive'] { border-color: var(--border); background: var(--success-surface); }
    .delta-card[data-delta='negative'] { border-color: var(--border); background: var(--danger-surface); }
    .delta-card[data-delta='zero'] { border-color: var(--border-accent); background: var(--accent-surface); }
    .delta-card[data-delta='unavailable'] { border-style: dashed; background: var(--surface-muted); }
    .positive-points { color: var(--success) !important; }
    .consistency-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 0;
      padding: 11px 13px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--success-surface);
    }
    .consistency-row strong, .consistency-row span { display: block; }
    .consistency-row > div > span { margin-top: 2px; color: var(--text-muted); font-size: 12px; }
    .consistency-icon {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--success-surface);
      color: var(--success);
      font-weight: 800;
    }
    .consistency-warning { border-color: var(--border); background: var(--warning-surface); }
    .consistency-warning .consistency-icon { background: var(--warning-surface); color: var(--warning); }
    @media (max-width: 900px) { .score-overview { grid-template-columns: 1fr; } }
    @media (max-width: 680px) { .metric-grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 460px) { .metric-card { min-height: 65px; padding: 12px; } }
  `],
})
export class ScoreBreakdownSummaryComponent {
  readonly showActions = input(true);
  readonly breakdown = input.required<DailyScoreBreakdown>();
  readonly detailed = input(false);
  readonly recalculating = input(false);
  readonly recalculationError = input<string | null>(null);
  readonly recalculate = output<void>();

  readonly deltaDescription = deltaDescription;
  readonly deltaKind = deltaKind;
  readonly deltaValue = deltaValue;
  readonly formatNumber = formatNumber;
  readonly formatSigned = formatSigned;
  readonly ledgerMatchesAppTotal = ledgerMatchesAppTotal;
  readonly ledgerSum = ledgerSum;
  readonly scoreAuthorityNote = scoreAuthorityNote;
  readonly scoreStatusLabel = scoreStatusLabel;
}
