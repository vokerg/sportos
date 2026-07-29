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
          <div class="eyebrow">Persisted score explanation</div>
          <h3 [id]="headingId">{{ date() ? 'Daily score · ' + date() : 'Daily score breakdown' }}</h3>
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
          <strong>Select Explain on a daily row.</strong>
          <span>The persisted totals, ledger contributions, activities, and source references will appear here.</span>
        </div>
      } @else if (state() === 'loading') {
        <div class="state-box" role="status">
          <strong>Loading score breakdown…</strong>
          <span>Reading the saved ledger and provenance for {{ date() }}.</span>
        </div>
      } @else if (state() === 'error') {
        <div class="state-box error-box" role="alert">
          <strong>Score breakdown could not be loaded.</strong>
          <span>{{ errorMessage() || 'The API returned an unexpected error.' }}</span>
          <button type="button" (click)="retry.emit()">Try again</button>
        </div>
      } @else if (!current) {
        <div class="state-box">
          <strong>No persisted score is available.</strong>
          <span>This date has no breakdown to display.</span>
        </div>
      } @else {
        <div class="summary-grid" aria-label="Score reconciliation totals">
          <div class="summary-item">
            <span>App total</span>
            <strong>{{ formatNumber(current.score.appTotal) }}</strong>
          </div>
          <div class="summary-item" [class.unavailable]="current.score.excelTotal === null">
            <span>Excel total</span>
            <strong>{{ current.score.excelTotal === null ? 'Not available' : formatNumber(current.score.excelTotal) }}</strong>
          </div>
          <div class="summary-item delta-card" [attr.data-delta]="deltaKind(current.score.delta)">
            <span>Delta vs Excel</span>
            <strong>{{ deltaValue(current.score.delta) }}</strong>
            <small>{{ deltaDescription(current.score.delta) }}</small>
          </div>
          <div class="summary-item">
            <span>Base</span>
            <strong>{{ formatNumber(current.score.baseTotal) }}</strong>
          </div>
          <div class="summary-item">
            <span>Bonus</span>
            <strong>{{ formatSigned(current.score.bonusTotal) }}</strong>
          </div>
          <div class="summary-item" [class.mismatch]="!ledgerMatchesAppTotal(current)">
            <span>Ledger sum</span>
            <strong>{{ formatNumber(ledgerSum(current)) }}</strong>
            <small>{{ ledgerMatchesAppTotal(current) ? 'Matches app total' : 'Does not match app total' }}</small>
          </div>
        </div>

        <div class="provenance-banner">
          <div>
            <strong>Daily source</strong>
            <span>{{ sourceSummary(current.sourceRecord) }}</span>
          </div>
          @if (current.sourceRecord) {
            <details>
              <summary>Source details</summary>
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
            <h4>Ledger contributions</h4>
            <p>{{ current.ledger.length }} persisted contribution{{ current.ledger.length === 1 ? '' : 's' }}</p>
          </div>
          <span class="recomputed">Recomputed {{ current.recomputedAt }}</span>
        </div>

        @if (current.ledger.length === 0) {
          <div class="state-box">
            <strong>No ledger entries were persisted.</strong>
            <span>The app total for this date is {{ formatNumber(current.score.appTotal) }}.</span>
          </div>
        } @else {
          <div class="ledger-scroll" tabindex="0" aria-label="Score ledger table; scroll horizontally for more columns">
            <table>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col" class="points-column">Points</th>
                  <th scope="col">Reason and inputs</th>
                  <th scope="col">Related activity</th>
                  <th scope="col">Provenance</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of current.ledger; track entry.id) {
                  <tr>
                    <td>
                      <strong>{{ entry.rule?.name || 'Rule unavailable' }}</strong>
                      <code>{{ entry.rule?.code || 'unlinked' }}</code>
                      @if (entry.rule) {
                        <small>Effective {{ entry.rule.validFrom }}{{ entry.rule.validTo ? ' – ' + entry.rule.validTo : ' onward' }}</small>
                      }
                    </td>
                    <td class="points-column" [class.positive-points]="entry.points > 0" [class.negative-points]="entry.points < 0">
                      {{ formatSigned(entry.points) }}
                    </td>
                    <td>
                      <strong>{{ entry.reason }}</strong>
                      <small>{{ calculationLabel(entry.calculation) }}</small>
                    </td>
                    <td>
                      <span>{{ activityLabel(entry.activity) }}</span>
                      @if (entry.activity?.notes) { <small>{{ entry.activity?.notes }}</small> }
                    </td>
                    <td>
                      <span>{{ sourceSummary(entry.activity?.sourceRecord || null) }}</span>
                      @if (entry.activity?.sourceRecord) {
                        <details>
                          <summary>Activity source</summary>
                          <dl>
                            <dt>Batch</dt><dd>{{ entry.activity?.sourceRecord?.batch?.id }}</dd>
                            <dt>Row hash</dt><dd class="hash">{{ entry.activity?.sourceRecord?.rowHash }}</dd>
                          </dl>
                        </details>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
  `,
  styles: [`
    .breakdown-panel {
      margin-top: 18px;
      border: 1px solid #d8e1f0;
      border-radius: 18px;
      padding: 18px;
      background: #f8faff;
    }

    .panel-header,
    .ledger-heading,
    .provenance-banner {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .panel-header h3,
    .ledger-heading h4,
    .ledger-heading p { margin: 0; }

    .eyebrow {
      margin-bottom: 4px;
      color: #475467;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .secondary-button {
      background: white;
      color: #1d4ed8;
      border: 1px solid #bfd0f6;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(120px, 1fr));
      gap: 10px;
      margin: 18px 0;
    }

    .summary-item {
      min-height: 82px;
      border-radius: 14px;
      padding: 12px;
      background: white;
      border: 1px solid #e2e8f0;
    }

    .summary-item span,
    .summary-item small,
    td small,
    td code,
    .ledger-heading p,
    .recomputed,
    .state-box span,
    .provenance-banner span {
      display: block;
      color: #667085;
      font-size: 12px;
    }

    .summary-item strong {
      display: block;
      margin-top: 5px;
      font-size: 22px;
    }

    .delta-card[data-delta='positive'] { border-color: #86efac; background: #f0fdf4; }
    .delta-card[data-delta='negative'] { border-color: #fca5a5; background: #fef2f2; }
    .delta-card[data-delta='zero'] { border-color: #93c5fd; background: #eff6ff; }
    .delta-card[data-delta='unavailable'], .summary-item.unavailable { border-style: dashed; background: #f9fafb; }
    .summary-item.mismatch { border-color: #f59e0b; background: #fffbeb; }

    .provenance-banner {
      padding: 12px 14px;
      border-radius: 14px;
      background: #eef3ff;
    }

    details { margin-top: 6px; }
    summary { cursor: pointer; color: #1d4ed8; font-size: 12px; font-weight: 700; }
    dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; margin: 8px 0 0; font-size: 11px; }
    dt { color: #667085; }
    dd { margin: 0; overflow-wrap: anywhere; }
    .hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

    .ledger-heading { margin: 20px 0 10px; }
    .recomputed { text-align: right; }
    .ledger-scroll { overflow-x: auto; border-radius: 14px; background: white; }
    .ledger-scroll:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
    table { width: 100%; min-width: 960px; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 12px; border-bottom: 1px solid #e4e7ec; text-align: left; vertical-align: top; }
    th { background: #f1f5fb; color: #344054; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
    td strong { display: block; margin-bottom: 4px; }
    td code { margin-bottom: 4px; }
    .points-column { width: 86px; text-align: right; font-weight: 750; }
    .positive-points { color: #087443; }
    .negative-points { color: #b42318; }

    .state-box {
      display: grid;
      gap: 6px;
      justify-items: start;
      padding: 20px;
      border: 1px dashed #c7d2e5;
      border-radius: 14px;
      background: white;
    }

    .error-box { border-color: #fca5a5; background: #fff7f7; }

    @media (max-width: 1180px) {
      .summary-grid { grid-template-columns: repeat(3, minmax(120px, 1fr)); }
    }

    @media (max-width: 680px) {
      .breakdown-panel { padding: 14px; }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panel-header, .ledger-heading, .provenance-banner { align-items: stretch; flex-direction: column; }
      .recomputed { text-align: left; }
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
