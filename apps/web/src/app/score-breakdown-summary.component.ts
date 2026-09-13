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
        <span class="total-note">{{ scoreAuthorityNote(current.scoreStatus) }}</span>
        <button type="button" class="secondary-button recalculation-action" (click)="recalculate.emit()" [disabled]="recalculating()">
          {{ recalculating() ? 'Recalculating…' : 'Recalculate from activities' }}
        </button>
        @if (recalculationError()) {
          <span class="recalculation-error" role="alert">{{ recalculationError() }}</span>
        }
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-label">{{ current.scoreStatus === 'imported' ? 'Imported ledger total' : 'Base' }}</span>
          <strong>{{ formatNumber(current.score.baseTotal) }}</strong>
        </div>
        <div class="metric-card">
          <span class="metric-label">{{ current.scoreStatus === 'imported' ? 'Calculated bonus' : 'Bonus' }}</span>
          <strong class="positive-points">{{ current.scoreStatus === 'imported' ? 'Not applied' : formatSigned(current.score.bonusTotal) }}</strong>
        </div>
        <div class="metric-card delta-card" [attr.data-delta]="deltaKind(current.score.delta)">
          <span class="metric-label">Compared with Excel</span>
          <strong>{{ deltaValue(current.score.delta) }}</strong>
          <small>{{ deltaDescription(current.score.delta) }}</small>
        </div>
      </div>
    </div>

    <div class="consistency-row" [class.consistency-warning]="!ledgerMatchesAppTotal(current)">
      <span class="consistency-icon" aria-hidden="true">{{ ledgerMatchesAppTotal(current) ? '✓' : '!' }}</span>
      <div>
        <strong>{{ ledgerMatchesAppTotal(current) ? 'Everything adds up' : 'Review the score details' }}</strong>
        <span>Ledger total: {{ formatNumber(ledgerSum(current)) }} · {{ ledgerMatchesAppTotal(current) ? 'matches' : 'does not match' }} the app total.</span>
      </div>
    </div>
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
      border: 1px solid #cfdaf7;
      border-radius: 14px;
      background: linear-gradient(145deg, #eef3ff, #ffffff);
    }
    .total-card > strong {
      margin: 4px 0 2px;
      color: #243b73;
      font-size: 38px;
      font-weight: 750;
      letter-spacing: -.04em;
    }
    .metric-label {
      color: #667085;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .status-badge { align-self: flex-start; padding: 4px 8px; border-radius: 999px; background: #eaf7ee; color: #13795b; font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
    .status-badge[data-status='calculated'] { background: #eef3ff; color: #40558f; }
    .status-badge[data-status='manual'] { background: #fff4dd; color: #945c00; }
    .total-note, .metric-card small { color: #667085; font-size: 12px; }
    .secondary-button { background: white; color: #40558f; border: 1px solid #cbd6ed; box-shadow: none; }
    .recalculation-action { align-self: flex-start; margin-top: 10px; font-size: 12px; }
    .recalculation-error { margin-top: 6px; color: #b54747; font-size: 12px; }
    .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .metric-card {
      display: flex;
      min-height: 96px;
      flex-direction: column;
      justify-content: center;
      padding: 14px;
      border: 1px solid #e1e7f0;
      border-radius: 14px;
      background: rgba(255, 255, 255, .8);
    }
    .metric-card strong { margin-top: 6px; color: #172b4d; font-size: 23px; }
    .delta-card[data-delta='positive'] { border-color: #b8e5c5; background: #f4fbf6; }
    .delta-card[data-delta='negative'] { border-color: #f2c7c7; background: #fff8f8; }
    .delta-card[data-delta='zero'] { border-color: #c6d8f5; background: #f5f9ff; }
    .delta-card[data-delta='unavailable'] { border-style: dashed; background: #fafbfc; }
    .positive-points { color: #13795b !important; }
    .consistency-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 0;
      padding: 11px 13px;
      border: 1px solid #cce8d5;
      border-radius: 12px;
      background: #f4fbf6;
    }
    .consistency-row strong, .consistency-row span { display: block; }
    .consistency-row > div > span { margin-top: 2px; color: #5e7666; font-size: 12px; }
    .consistency-icon {
      display: grid;
      flex: 0 0 auto;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #dff4e5;
      color: #13795b;
      font-weight: 800;
    }
    .consistency-warning { border-color: #f3d39b; background: #fffaf0; }
    .consistency-warning .consistency-icon { background: #ffedc7; color: #a15c00; }
    @media (max-width: 900px) { .score-overview { grid-template-columns: 1fr; } }
    @media (max-width: 680px) { .metric-grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 460px) { .metric-grid { grid-template-columns: 1fr; } }
  `],
})
export class ScoreBreakdownSummaryComponent {
  readonly breakdown = input.required<DailyScoreBreakdown>();
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
