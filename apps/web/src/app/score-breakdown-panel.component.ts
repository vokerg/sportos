import { Component, input, output } from '@angular/core';
import type {
  DailyScoreBreakdown,
  JsonValue,
  ScoreBreakdownActivity,
  ScoreBreakdownLedgerEntry,
  SourceRecordReference,
} from './score-breakdown.models';

export type ScoreBreakdownViewState = 'idle' | 'loading' | 'loaded' | 'error';
export type DeltaKind = 'positive' | 'negative' | 'zero' | 'unavailable';

@Component({
  selector: 'sportos-score-breakdown-panel',
  standalone: true,
  template: `
    <section
      class="breakdown-panel"
      aria-live="polite"
      [attr.aria-busy]="state() === 'loading'"
      [attr.aria-labelledby]="headingId">
      <header class="panel-header">
        <div>
          <div class="eyebrow">Score explanation</div>
          <h3 [id]="headingId">{{ date() ? 'Daily score · ' + date() : 'Daily score breakdown' }}</h3>
          <p class="panel-subtitle">A clear view of how this day's score was built.</p>
        </div>
        @if (date()) {
          <button type="button" class="secondary-button" aria-label="Close score breakdown" (click)="closed.emit()">
            Close
          </button>
        }
      </header>

      @let current = breakdown();
      @if (state() === 'idle') {
        <div class="state-box">
          <span class="state-icon" aria-hidden="true">✦</span>
          <div>
            <strong>Select View details on a daily row.</strong>
            <span>The score, contributing activities, and source will appear here.</span>
          </div>
        </div>
      } @else if (state() === 'loading') {
        <div class="state-box" role="status">
          <span class="state-icon loading-icon" aria-hidden="true">…</span>
          <div>
            <strong>Loading score breakdown…</strong>
            <span>Reading the saved score for {{ date() }}.</span>
          </div>
        </div>
      } @else if (state() === 'error') {
        <div class="state-box error-box" role="alert">
          <span class="state-icon" aria-hidden="true">!</span>
          <div>
            <strong>Score breakdown could not be loaded.</strong>
            <span>{{ errorMessage() || 'The API returned an unexpected error.' }}</span>
          </div>
          <button type="button" (click)="retry.emit()">Try again</button>
        </div>
      } @else if (!current) {
        <div class="state-box">
          <span class="state-icon" aria-hidden="true">—</span>
          <div>
            <strong>No score is available for this date.</strong>
            <span>There is no saved breakdown to display.</span>
          </div>
        </div>
      } @else {
        <div class="score-overview" aria-label="Score summary">
          <div class="total-card">
            <span class="metric-label">Total score</span>
            <strong>{{ formatNumber(current.score.appTotal) }}</strong>
            <span class="total-note">Saved in SportOS</span>
          </div>
          <div class="metric-grid">
            <div class="metric-card">
              <span class="metric-label">Base</span>
              <strong>{{ formatNumber(current.score.baseTotal) }}</strong>
            </div>
            <div class="metric-card">
              <span class="metric-label">Bonus</span>
              <strong class="positive-points">{{ formatSigned(current.score.bonusTotal) }}</strong>
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

        <div class="ledger-heading">
          <div>
            <span class="section-label">Score details</span>
            <h4>How the score was built</h4>
            <p>{{ current.ledger.length }} contribution{{ current.ledger.length === 1 ? '' : 's' }} to this day's total</p>
          </div>
          <span class="recomputed">Saved {{ current.recomputedAt }}</span>
        </div>

        @if (current.ledger.length === 0) {
          <div class="state-box">
            <strong>No contributions were saved.</strong>
            <span>The app total for this date is {{ formatNumber(current.score.appTotal) }}.</span>
          </div>
        } @else {
          <div class="ledger-list" aria-label="Score contributions">
            @for (entry of current.ledger; track entry.id) {
              <article class="ledger-entry">
                <div class="entry-top">
                  <div class="rule-copy">
                    <span class="rule-dot" aria-hidden="true"></span>
                    <div>
                      <strong>{{ entry.rule?.name || 'Rule unavailable' }}</strong>
                      <code>{{ entry.rule?.code || 'unlinked' }}</code>
                    </div>
                  </div>
                  <span class="points-pill" [class.positive-points]="entry.points > 0" [class.negative-points]="entry.points < 0">
                    {{ formatSigned(entry.points) }}
                  </span>
                </div>
                <p class="entry-reason">{{ entry.reason }}</p>
                <div class="entry-context">
                  <span><small>Activity</small>{{ activityLabel(entry.activity) }}</span>
                  <span><small>Source</small>{{ sourceSummary(entry.activity?.sourceRecord || null) }}</span>
                </div>
                <details class="entry-details">
                  <summary>Show calculation details</summary>
                  <div class="detail-grid">
                    <div>
                      <span class="detail-label">Inputs</span>
                      <p>{{ calculationLabel(entry.calculation) }}</p>
                    </div>
                    @if (entry.rule) {
                      <div>
                        <span class="detail-label">Rule active</span>
                        <p>{{ entry.rule.validFrom }}{{ entry.rule.validTo ? ' – ' + entry.rule.validTo : ' onward' }}</p>
                      </div>
                    }
                    @if (entry.activity?.notes) {
                      <div>
                        <span class="detail-label">Notes</span>
                        <p>{{ entry.activity?.notes }}</p>
                      </div>
                    }
                    @if (entry.activity?.sourceRecord) {
                      <div>
                        <span class="detail-label">Activity provenance</span>
                        <p>Batch {{ entry.activity?.sourceRecord?.batch?.id }} · Row {{ entry.activity?.sourceRecord?.rowHash }}</p>
                      </div>
                    }
                  </div>
                </details>
              </article>
            }
          </div>
        }
      }
    </section>
  `,
  styles: [`
    .breakdown-panel {
      margin-top: 18px;
      border: 1px solid #dbe4f0;
      border-left: 4px solid #8b9de8;
      border-radius: 16px;
      padding: 20px;
      background: linear-gradient(145deg, #fbfcff 0%, #f4f7fc 100%);
      box-shadow: 0 8px 24px rgba(36, 55, 95, .07);
    }

    .panel-header,
    .ledger-heading,
    .source-card {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .panel-header h3,
    .ledger-heading h4,
    .ledger-heading p { margin: 0; }

    .panel-header h3 { color: #172b4d; font-size: 22px; }
    .panel-subtitle { margin: 5px 0 0; color: #667085; font-size: 13px; }

    .eyebrow,
    .section-label,
    .metric-label,
    .detail-label {
      color: #667085;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .06em;
      text-transform: uppercase;
    }

    .eyebrow { margin-bottom: 5px; color: #5b6cae; }

    .secondary-button {
      background: white;
      color: #40558f;
      border: 1px solid #cbd6ed;
      box-shadow: none;
    }

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

    .total-card strong {
      margin: 4px 0 2px;
      color: #243b73;
      font-size: 38px;
      font-weight: 750;
      letter-spacing: -.04em;
    }

    .total-note,
    .metric-card small,
    .ledger-heading p,
    .recomputed,
    .state-box span,
    .source-card span,
    .entry-context small,
    .detail-grid p {
      color: #667085;
      font-size: 12px;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

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

    .metric-card strong {
      margin-top: 6px;
      color: #172b4d;
      font-size: 23px;
    }

    .delta-card[data-delta='positive'] { border-color: #b8e5c5; background: #f4fbf6; }
    .delta-card[data-delta='negative'] { border-color: #f2c7c7; background: #fff8f8; }
    .delta-card[data-delta='zero'] { border-color: #c6d8f5; background: #f5f9ff; }
    .delta-card[data-delta='unavailable'] { border-style: dashed; background: #fafbfc; }

    .positive-points { color: #13795b !important; }
    .negative-points { color: #b54747 !important; }

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

    .consistency-row strong,
    .consistency-row span { display: block; }
    .consistency-row > div > span { margin-top: 2px; color: #5e7666; font-size: 12px; }
    .consistency-icon,
    .source-icon,
    .state-icon {
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

    .source-card {
      align-items: center;
      justify-content: flex-start;
      margin: 14px 0 22px;
      padding: 12px 14px;
      border: 1px solid #e1e7f0;
      border-radius: 12px;
      background: rgba(255, 255, 255, .72);
    }

    .source-icon { background: #e9edff; color: #5368ae; }
    .source-copy { min-width: 0; flex: 1; }
    .source-copy strong { display: block; margin-top: 3px; color: #344054; font-size: 13px; }

    details { margin-top: 6px; }
    summary { cursor: pointer; color: #5267a8; font-size: 12px; font-weight: 700; }
    summary:focus-visible { outline: 3px solid #a8b9ef; outline-offset: 3px; border-radius: 4px; }
    dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 8px 0 0; font-size: 11px; }
    dt { color: #667085; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .hash, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    code { color: #667085; font-size: 11px; }

    .ledger-heading { align-items: end; margin: 20px 0 10px; }
    .ledger-heading h4 { margin-top: 3px; color: #172b4d; font-size: 17px; }
    .ledger-heading p { margin-top: 4px; }
    .recomputed { text-align: right; white-space: nowrap; }

    .ledger-list { display: grid; gap: 10px; }
    .ledger-entry {
      padding: 15px;
      border: 1px solid #e1e7f0;
      border-radius: 14px;
      background: white;
      box-shadow: 0 2px 6px rgba(36, 55, 95, .03);
    }

    .entry-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .rule-copy { display: flex; align-items: flex-start; gap: 9px; min-width: 0; }
    .rule-dot { width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: #8b9de8; box-shadow: 0 0 0 4px #eef1ff; }
    .rule-copy strong { display: block; color: #243b73; font-size: 14px; }
    .rule-copy code { display: block; margin-top: 3px; }
    .points-pill { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; background: #e6f6eb; font-size: 15px; font-weight: 800; }
    .entry-reason { margin: 13px 0 10px; color: #344054; font-size: 14px; line-height: 1.45; }
    .entry-context { display: flex; flex-wrap: wrap; gap: 8px; }
    .entry-context > span { padding: 7px 9px; border-radius: 8px; background: #f7f9fc; color: #475467; font-size: 12px; }
    .entry-context small { display: block; margin-bottom: 2px; font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .entry-details { margin-top: 12px; padding-top: 10px; border-top: 1px solid #edf0f5; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .detail-grid > div { padding: 9px; border-radius: 8px; background: #f8fafc; }
    .detail-grid p { margin: 4px 0 0; overflow-wrap: anywhere; line-height: 1.45; }

    .state-box {
      display: flex;
      align-items: flex-start;
      gap: 11px;
      padding: 18px;
      border: 1px dashed #c7d2e5;
      border-radius: 14px;
      background: white;
    }

    .state-box > div { display: grid; gap: 5px; }
    .loading-icon { background: #e9edff; color: #5368ae; }
    .error-box { border-color: #efb9b9; background: #fff8f8; }
    .error-box .state-icon { background: #ffe2e2; color: #b54747; }
    .error-box button { margin-left: auto; }

    @media (max-width: 900px) {
      .score-overview { grid-template-columns: 1fr; }
    }

    @media (max-width: 680px) {
      .breakdown-panel { padding: 14px; }
      .metric-grid, .detail-grid { grid-template-columns: 1fr 1fr; }
      .panel-header, .ledger-heading { align-items: stretch; flex-direction: column; }
      .recomputed { text-align: left; }
    }

    @media (max-width: 460px) {
      .metric-grid, .detail-grid { grid-template-columns: 1fr; }
      .entry-top { flex-direction: column; }
    }
  `],
})
export class ScoreBreakdownPanelComponent {
  readonly state = input<ScoreBreakdownViewState>('idle');
  readonly date = input<string | null>(null);
  readonly breakdown = input<DailyScoreBreakdown | null>(null);
  readonly errorMessage = input<string | null>(null);
  readonly retry = output<void>();
  readonly closed = output<void>();

  readonly headingId = 'daily-score-breakdown-heading';
  private readonly numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

  deltaKind(delta: number | null): DeltaKind {
    if (delta === null) return 'unavailable';
    if (delta > 0) return 'positive';
    if (delta < 0) return 'negative';
    return 'zero';
  }

  deltaValue(delta: number | null): string {
    if (delta === null) return 'Not available';
    if (delta > 0) return `+${this.formatNumber(delta)}`;
    if (delta < 0) return `−${this.formatNumber(Math.abs(delta))}`;
    return '0';
  }

  deltaDescription(delta: number | null): string {
    if (delta === null) return 'No spreadsheet total was imported';
    if (delta > 0) return 'App total is above Excel';
    if (delta < 0) return 'App total is below Excel';
    return 'App and Excel totals match';
  }

  formatNumber(value: number): string {
    return this.numberFormatter.format(value);
  }

  formatSigned(value: number): string {
    if (value > 0) return `+${this.formatNumber(value)}`;
    if (value < 0) return `−${this.formatNumber(Math.abs(value))}`;
    return '0';
  }

  ledgerSum(breakdown: DailyScoreBreakdown): number {
    return breakdown.ledger.reduce((sum, entry) => sum + entry.points, 0);
  }

  ledgerMatchesAppTotal(breakdown: DailyScoreBreakdown): boolean {
    return this.ledgerSum(breakdown) === breakdown.score.appTotal;
  }

  calculationLabel(value: JsonValue): string {
    if (value === null) return 'No calculation inputs';
    if (Array.isArray(value)) return value.map((item) => this.calculationLabel(item)).join(', ');
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      return entries.length === 0
        ? 'No calculation inputs'
        : entries.map(([key, item]) => `${this.humanize(key)}: ${this.calculationLabel(item)}`).join(' · ');
    }
    return String(value);
  }

  activityLabel(activity: ScoreBreakdownActivity | null): string {
    if (!activity) return 'No linked activity';
    const parts = [this.humanize(activity.activityType), activity.subtype ? this.humanize(activity.subtype) : null];
    if (activity.distanceM !== null) parts.push(`${this.formatNumber(activity.distanceM / 1000)} km`);
    if (activity.durationS !== null) parts.push(this.formatDuration(activity.durationS));
    if (activity.steps !== null) parts.push(`${this.formatNumber(activity.steps)} steps`);
    if (activity.effortPoints !== null) parts.push(`${this.formatNumber(activity.effortPoints)} effort`);
    return parts.filter((part): part is string => Boolean(part)).join(' · ');
  }

  sourceSummary(source: SourceRecordReference | null): string {
    if (!source) return 'Source link unavailable';
    const workbook = source.batch.filename || source.batch.source;
    const location = source.sheetName
      ? `${source.sheetName}${source.rowIndex === null ? '' : ` row ${source.rowIndex}`}`
      : source.rowIndex === null ? 'row unavailable' : `row ${source.rowIndex}`;
    return `${workbook} · ${location}`;
  }

  ruleLabel(entry: ScoreBreakdownLedgerEntry): string {
    return entry.rule ? `${entry.rule.name} (${entry.rule.code})` : 'Rule unavailable';
  }

  private formatDuration(seconds: number): string {
    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainingSeconds = rounded % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
      : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  private humanize(value: string): string {
    return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }
}
