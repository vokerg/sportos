import { ColorSchemeService } from './core/theme/color-scheme.service';
import { inject, Component, computed, HostListener, input, output, signal } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { DailySummaryRow } from './features/daily/model/daily.models';
import { localCalendarDate } from './shared/util/analytics-query-state';
import {
  dailyLogChartOptions,
  dailyLogLegendItems,
  dailyLogRowAtChartIndex,
  type DailyTrendWindow,
} from './daily-log.view-model';

@Component({
  selector: 'sportos-daily-log-trend',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <section class="trend-panel" aria-label="Daily score trend">
      <div class="mobile-trend-header">
        <div class="trend-heading">
          <h3>Score trend</h3>
          <small>Daily points · tap a bar for details</small>
        </div>
        <div class="trend-range" role="group" aria-label="Chart time window">
          <button type="button" [class.selected]="windowDays() === 14"
            [attr.aria-pressed]="windowDays() === 14" (click)="setWindowDays(14)">14d</button>
          <button type="button" [class.selected]="windowDays() === 30"
            [attr.aria-pressed]="windowDays() === 30" (click)="setWindowDays(30)">30d</button>
          <button type="button" [class.selected]="windowDays() === 'all'"
            [attr.aria-pressed]="windowDays() === 'all'" (click)="setWindowDays('all')">All</button>
        </div>
      </div>
      <div
        class="daily-chart"
        echarts [theme]="colorScheme.chartTheme()"
        [options]="chartOptions()"
        (chartClick)="handleChartClick($event)"
        role="img"
        aria-label="Stacked daily score contributions and a 30 day average on the same points scale. Select a bar to open that day.">
      </div>
      <div class="mobile-trend-legend" aria-label="Chart legend">
        @for (item of legendItems(); track item.label) {
          <span class="legend-item">
            <span class="legend-swatch" [class.line]="item.type === 'line'"
              [style.background-color]="item.color" aria-hidden="true"></span>
            {{ item.label }}
          </span>
        }
      </div>
      @if (hasToday()) {
        <p class="mobile-trend-note">* Today's score is incomplete</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; margin-top: 18px; }
    .daily-chart { width: 100%; height: min(64vh, 760px); min-height: 480px; }
    .mobile-trend-header, .mobile-trend-legend, .mobile-trend-note { display: none; }

    @media (max-width: 760px) {
      .trend-panel {
        min-width: 0;
        padding: 12px 10px 10px;
        border: 1px solid var(--border);
        border-radius: 15px;
        background: var(--surface);
      }
      .mobile-trend-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        padding: 0 2px 8px;
      }
      .trend-heading h3 { margin: 0 0 2px; font-size: 15px; letter-spacing: -.01em; }
      .trend-heading small { color: var(--text-muted); font-size: 11px; }
      .trend-range { display: flex; gap: 2px; padding: 3px; border-radius: 9px; background: var(--accent-surface); }
      .trend-range button {
        min-height: 36px;
        padding: 7px 10px;
        border-radius: 7px;
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
      }
      .trend-range button.selected {
        background: var(--surface);
        color: var(--link);
        box-shadow: 0 1px 3px rgba(16, 24, 40, .12);
      }
      .daily-chart { height: 235px; min-height: 0; }
      .mobile-trend-legend {
        display: flex;
        gap: 14px;
        overflow-x: auto;
        padding: 3px 2px 8px;
        scrollbar-width: thin;
        -webkit-overflow-scrolling: touch;
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        gap: 5px;
        white-space: nowrap;
        color: var(--text-secondary);
        font-size: 11px;
      }
      .legend-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
      .legend-swatch.line { width: 15px; height: 3px; border-radius: 3px; }
      .mobile-trend-note { display: block; margin: 0 2px; color: var(--text-muted); font-size: 10px; }
    }
  `],
})
export class DailyLogTrendComponent {
  readonly colorScheme = inject(ColorSchemeService);
  readonly rows = input<DailySummaryRow[]>([]);
  readonly openDay = output<string>();
  readonly windowDays = signal<DailyTrendWindow>(14);
  readonly isCompact = signal(typeof window !== 'undefined' && window.innerWidth <= 760);
  readonly visibleWindow = computed<DailyTrendWindow>(() => this.isCompact() ? this.windowDays() : 'all');
  readonly chartOptions = computed(() => dailyLogChartOptions(this.rows(), {
    windowDays: this.visibleWindow(),
    compact: this.isCompact(),
  }));
  readonly legendItems = computed(() => dailyLogLegendItems(this.rows(), this.visibleWindow()));
  readonly hasToday = computed(() => this.rows().some((row) => row.metric_date === localCalendarDate()));

  @HostListener('window:resize')
  onResize(): void {
    this.isCompact.set(typeof window !== 'undefined' && window.innerWidth <= 760);
  }

  setWindowDays(value: DailyTrendWindow): void {
    this.windowDays.set(value);
  }

  handleChartClick(event: { seriesType?: string; dataIndex?: number }): void {
    if (event.seriesType !== 'bar' || !Number.isInteger(event.dataIndex)) return;
    const row = dailyLogRowAtChartIndex(this.rows(), event.dataIndex!, this.visibleWindow());
    if (row) this.openDay.emit(row.metric_date);
  }
}
