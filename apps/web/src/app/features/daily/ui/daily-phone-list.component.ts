import { DecimalPipe } from '@angular/common';
import { Component, computed, input, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDate } from '../../../date-time';
import { localCalendarDate } from '../../../shared/util/analytics-query-state';
import type { DailySummaryRow } from '../model/daily.models';

const PAGE_SIZE = 7;

@Component({
  selector: 'sportos-daily-phone-list',
  standalone: true,
  imports: [DecimalPipe, RouterLink],
  template: `
    <section aria-labelledby="daily-phone-title">
      <h3 id="daily-phone-title">Daily entries</h3>
      <ul>
        @for (day of visibleDays(); track day.metric_date) {
          <li>
            <a [routerLink]="['/daily', day.metric_date]">
              <div class="day">
                <time [attr.datetime]="day.metric_date">{{ formatDate(day.metric_date) }}</time>
                @if (day.metric_date === today) { <small class="incomplete">Today · incomplete</small> }
              </div>
              <div class="score">
                <strong>{{ day.total_points | number:'1.0-2' }}</strong>
                <small>points</small>
              </div>
              <span aria-hidden="true">›</span>
            </a>
          </li>
        }
      </ul>
      @if (pageCount() > 1) {
        <div class="pagination" role="group" aria-label="Daily entry pages">
          <button class="secondary" type="button" [disabled]="page() === 0" (click)="changePage(-1)">Newer</button>
          <small role="status">{{ page() + 1 }} of {{ pageCount() }}</small>
          <button class="secondary" type="button" [disabled]="page() + 1 === pageCount()" (click)="changePage(1)">Older</button>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; margin-top: 18px; }
    h3 { margin: 0 0 8px; font-size: 16px; }
    ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 12px; }
    li + li { border-top: 1px solid var(--border); }
    a {
      display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center;
      gap: 10px; min-height: 54px; padding: 8px 10px; text-decoration: none; border-radius: 10px;
    }
    a:is(:hover, :focus-visible) { background: var(--accent-surface); }
    .day, .score { display: grid; gap: 2px; }
    time { font-size: 14px; font-weight: 700; }
    .score { text-align: end; font-variant-numeric: tabular-nums; color: var(--text); }
    small { color: var(--text-muted); font-size: 12px; }
    .incomplete { color: var(--warning); }
    .pagination { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 8px; }
    button { min-height: 44px; }
  `],
})
export class DailyPhoneListComponent {
  readonly rows = input.required<readonly DailySummaryRow[]>();
  readonly today = localCalendarDate();
  readonly formatDate = formatDate;
  readonly days = computed(() => [...this.rows()].sort((a, b) => b.metric_date.localeCompare(a.metric_date)));
  readonly page = linkedSignal(() => {
    this.rows();
    return 0;
  });
  readonly pageCount = computed(() => Math.ceil(this.days().length / PAGE_SIZE));
  readonly visibleDays = computed(() => {
    const start = this.page() * PAGE_SIZE;
    return this.days().slice(start, start + PAGE_SIZE);
  });

  changePage(offset: number): void {
    this.page.update(value => value + offset);
  }
}
