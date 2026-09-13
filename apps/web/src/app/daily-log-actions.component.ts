import { Component, input, output } from '@angular/core';

@Component({
  selector: 'sportos-daily-log-actions',
  standalone: true,
  template: `
    <div class="activity-recalculation">
      <div>
        <span class="recalculation-label">Explicit recalculation</span>
        <strong>Calculate a date from Strava activities</strong>
        <small>Use this when a daily ledger row is missing. Existing imported rows can also be recalculated from the details panel.</small>
      </div>
      <label>Date <input type="date" [value]="date()" (input)="dateChange.emit($any($event.target).value)" /></label>
      <button type="button" [disabled]="working() || !date()" (click)="recalculate.emit()">
        Calculate from Strava
      </button>
      <button type="button" class="secondary" [disabled]="!date()" (click)="manualEntry.emit()">
        Enter facts manually
      </button>
      @if (errorMessage()) {
        <p class="recalculation-error" role="alert">{{ errorMessage() }}</p>
      }
    </div>
  `,
  styles: [`
    .activity-recalculation { display: flex; align-items: end; gap: 14px; margin: 16px 0 20px; padding: 14px; border: 1px solid #dbe4f0; border-radius: 12px; background: #f8faff; }
    .activity-recalculation > div:first-child { display: grid; gap: 4px; min-width: 0; flex: 1; }
    .activity-recalculation strong { color: #243b73; font-size: 14px; }
    .activity-recalculation small { color: #667085; font-size: 12px; line-height: 1.4; }
    .recalculation-label { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .recalculation-error { flex-basis: 100%; margin: 0; color: #b54747; font-size: 12px; }
    @media (max-width: 760px) { .activity-recalculation { align-items: stretch; flex-direction: column; } }
  `],
})
export class DailyLogActionsComponent {
  readonly date = input('');
  readonly working = input(false);
  readonly errorMessage = input<string | null>(null);

  readonly dateChange = output<string>();
  readonly recalculate = output<void>();
  readonly manualEntry = output<void>();
}
