import { Component, input, output } from '@angular/core';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import type { ScoreBreakdownViewState } from './score-breakdown-panel.component';
import { formatDate } from './date-time';

@Component({
  selector: 'sportos-daily-quick-sheet',
  standalone: true,
  template: `
    @if (date()) {
      <div class="sheet-layer" role="dialog" aria-modal="true" [attr.aria-labelledby]="headingId">
        <button type="button" class="sheet-scrim" aria-label="Close selected day" (click)="closed.emit()"></button>
        <aside class="sheet">
          <header>
            <div><span class="eyebrow">Selected day</span><h3 [id]="headingId">{{ formatDate(date()) }}</h3></div>
            <button type="button" class="close-button" aria-label="Close selected day" (click)="closed.emit()">×</button>
          </header>

          @if (state() === 'loading') {
            <p role="status">Loading daily highlights…</p>
          } @else if (state() === 'error') {
            <div class="state-message error" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="retry.emit()">Try again</button></div>
          } @else if (breakdown()) {
            @let current = breakdown()!;
            <section class="total">
              <span>Total score</span><strong>{{ number(current.score.appTotal) }}</strong>
              <small [attr.data-status]="current.scoreStatus">{{ statusLabel(current.scoreStatus) }}</small>
            </section>
            <div class="facts">
              <div><span>Steps</span><strong>{{ number(current.facts.steps) }}</strong></div>
              <div><span>Run</span><strong>{{ distance(current.facts.runM) }}</strong></div>
              <div><span>Bike</span><strong>{{ distance(current.facts.bikeM) }}</strong></div>
              <div><span>Swim</span><strong>{{ distance(current.facts.swimM, 0) }}</strong></div>
              <div><span>Workout</span><strong>{{ number(current.facts.workoutPoints) }}</strong></div>
              <div><span>Power</span><strong>{{ number(current.facts.powerPoints) }}</strong></div>
            </div>
            <section class="highlights">
              <div class="section-heading"><h4>Activities</h4><span>{{ current.activities.length }}</span></div>
              @for (activity of current.activities.slice(0, 3); track activity.id) {
                <article>
                  <div><strong>{{ activity.activityType }}{{ activity.subtype ? ' · ' + activity.subtype : '' }}</strong><small>{{ activity.source }} · {{ activity.distanceM === null ? 'no distance' : distance(activity.distanceM) }}</small></div>
                  <span>{{ activity.durationS === null ? '—' : duration(activity.durationS) }}</span>
                </article>
              }
              @if (current.activities.length > 3) { <p>+ {{ current.activities.length - 3 }} more on the full day page</p> }
            </section>
            <section class="provenance">
              <span>Raw source records</span><strong>{{ current.sourceRecords.length }}</strong>
              <small>Workbook cells and provider JSON remain available on the full day page.</small>
            </section>
            <div class="sheet-actions">
              <button type="button" (click)="edit.emit()">Edit complete facts</button>
              <button type="button" class="secondary" (click)="recalculate.emit()" [disabled]="recalculating()">{{ recalculating() ? 'Recalculating…' : 'Recalculate' }}</button>
              <button type="button" class="full" (click)="opened.emit()">Open complete day →</button>
            </div>
            @if (recalculationError()) { <p class="inline-error" role="alert">{{ recalculationError() }}</p> }
          } @else {
            <p>No persisted score is available for this date.</p>
            <button type="button" (click)="edit.emit()">Enter facts manually</button>
          }
        </aside>
      </div>
    }
  `,
  styles: [`
    .sheet-layer { position: fixed; z-index: 200; inset: 0; }
    .sheet-scrim { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 0; background: rgba(13, 23, 43, .25); backdrop-filter: blur(1px); }
    .sheet { position: absolute; top: 0; right: 0; width: min(430px, 94vw); height: 100%; padding: 24px; overflow-y: auto; background: #f7f9fc; box-shadow: -20px 0 55px rgba(20, 33, 61, .22); }
    header, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    h3, h4 { margin: 0; } h3 { margin-top: 4px; font-size: 21px; }
    .eyebrow { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .close-button { width: 36px; height: 36px; padding: 0; border: 1px solid #d0d5dd; background: #fff; color: #344054; font-size: 21px; }
    .total { display: grid; gap: 5px; margin: 22px 0 14px; padding: 18px; border-radius: 14px; background: #eef3ff; }
    .total > span, .facts span, .provenance span { color: #667085; font-size: 11px; }
    .total strong { color: #243b73; font-size: 36px; }
    .total small { width: max-content; padding: 4px 8px; border-radius: 999px; background: #fff4dd; color: #945c00; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .total small[data-status='calculated'] { background: #e7edff; color: #40558f; }
    .total small[data-status='imported'] { background: #e6f6eb; color: #13795b; }
    .facts { display: grid; grid-template-columns: repeat(2, 1fr); overflow: hidden; border: 1px solid #e1e7f0; border-radius: 12px; background: #fff; }
    .facts div { display: grid; gap: 4px; padding: 12px; border-right: 1px solid #edf0f5; border-bottom: 1px solid #edf0f5; }
    .facts div:nth-child(2n) { border-right: 0; } .facts div:nth-last-child(-n+2) { border-bottom: 0; }
    .facts strong { font-size: 14px; }
    .highlights, .provenance { margin-top: 20px; padding-top: 18px; border-top: 1px solid #e1e7f0; }
    .section-heading span { padding: 4px 7px; border-radius: 999px; background: #e8edfb; color: #40558f; font-size: 10px; font-weight: 800; }
    article { display: flex; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid #edf0f5; font-size: 12px; }
    article strong, article small { display: block; } article small, .highlights p, .provenance small { margin-top: 3px; color: #667085; font-size: 10px; }
    .provenance { display: grid; gap: 4px; }.provenance strong { font-size: 22px; }
    .sheet-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 22px; }
    .sheet-actions .full { grid-column: 1 / -1; background: #172b4d; }
    .inline-error { color: #b54747; font-size: 12px; }
  `],
})
export class DailyQuickSheetComponent {
  readonly state = input<ScoreBreakdownViewState>('idle');
  readonly date = input<string | null>(null);
  readonly breakdown = input<DailyScoreBreakdown | null>(null);
  readonly errorMessage = input<string | null>(null);
  readonly recalculating = input(false);
  readonly recalculationError = input<string | null>(null);
  readonly closed = output<void>();
  readonly opened = output<void>();
  readonly edit = output<void>();
  readonly retry = output<void>();
  readonly recalculate = output<void>();
  readonly headingId = 'daily-quick-sheet-heading';
  readonly formatDate = formatDate;

  number(value: number): string { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value); }
  distance(value: number, digits = 2): string { return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: digits })} km`; }
  duration(value: number): string {
    const minutes = Math.floor(value / 60);
    return `${minutes}:${String(Math.round(value % 60)).padStart(2, '0')}`;
  }
  statusLabel(status: DailyScoreBreakdown['scoreStatus']): string {
    return status === 'imported' ? 'Imported ledger' : status === 'manual' ? 'Manual edit' : 'Calculated';
  }
}
