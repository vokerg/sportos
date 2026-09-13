import { Component, input, output } from '@angular/core';
import type { QuickRange } from './daily-log.view-model';

@Component({
  selector: 'sportos-daily-log-filters',
  standalone: true,
  template: `
    <form class="filter-bar" (submit)="apply.emit(); $event.preventDefault()" aria-label="Daily Log date range">
      <label>Quick range
        <select [value]="quickRange()" (change)="quickRangeChange.emit($any($event.target).value)">
          <option value="custom">Custom range</option>
          <option value="1m">1 month</option>
          <option value="3m">3 months</option>
          <option value="6m">6 months</option>
          <option value="ytd">YTD</option>
          <option value="1y">1 year</option>
          <option value="3y">3 years</option>
          <option value="all">All time</option>
        </select>
      </label>
      <label>From <input type="date" [value]="from()" (input)="fromChange.emit($any($event.target).value)" /></label>
      <label>To <input type="date" [value]="to()" (input)="toChange.emit($any($event.target).value)" /></label>
      <button type="submit" [disabled]="loading()">Apply range</button>
      <button type="button" class="secondary" (click)="reset.emit()">Reset</button>
    </form>
  `,
})
export class DailyLogFiltersComponent {
  readonly quickRange = input<QuickRange>('3m');
  readonly from = input('');
  readonly to = input('');
  readonly loading = input(false);

  readonly quickRangeChange = output<string>();
  readonly fromChange = output<string>();
  readonly toChange = output<string>();
  readonly apply = output<void>();
  readonly reset = output<void>();
}
