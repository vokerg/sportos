import { ColorSchemeService } from './core/theme/color-scheme.service';
import { inject, Component, computed, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { DailySummaryRow } from './features/daily/model/daily.models';
import { dailyLogChartOptions, dailyLogRowAtChartIndex } from './daily-log.view-model';

@Component({
  selector: 'sportos-daily-log-trend',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <div class="mobile-chart-intro">
      <strong>Daily score trend</strong>
      <span>Latest days · move the slider to browse older scores</span>
    </div>
    <div
      class="daily-chart"
      echarts [theme]="colorScheme.chartTheme()"
      [options]="chartOptions()"
      (chartClick)="handleChartClick($event)"
      role="img"
      aria-label="Stacked daily score contributions and a 30 day average on the same points scale. Select a bar to open that day.">
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; max-width: 100%; }
    .mobile-chart-intro { display: none; }
    .daily-chart { width: 100%; height: min(64vh, 760px); min-height: 480px; }
    @media (max-width: 760px) {
      :host { box-sizing: border-box; padding: 12px 8px 4px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-muted); }
      .mobile-chart-intro { display: grid; gap: 4px; padding: 0 6px; }
      .mobile-chart-intro strong { font-size: 15px; }
      .mobile-chart-intro span { color: var(--text-muted); font-size: 11px; }
      .daily-chart { height: 350px; min-height: 0; }
    }
  `],
})
export class DailyLogTrendComponent {
  readonly colorScheme = inject(ColorSchemeService);
  readonly rows = input<DailySummaryRow[]>([]);
  readonly openDay = output<string>();
  readonly chartOptions = computed(() => dailyLogChartOptions(this.rows()));

  handleChartClick(event: { seriesType?: string; dataIndex?: number }): void {
    if (event.seriesType !== 'bar' || !Number.isInteger(event.dataIndex)) return;
    const row = dailyLogRowAtChartIndex(this.rows(), event.dataIndex!);
    if (row) this.openDay.emit(row.metric_date);
  }
}
