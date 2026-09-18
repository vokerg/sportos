import { Component, computed, input, output } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { DailySummaryRow } from './api.service';
import { dailyLogChartOptions, dailyLogRowAtChartIndex } from './daily-log.view-model';

@Component({
  selector: 'sportos-daily-log-trend',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <div
      class="daily-chart"
      echarts
      [options]="chartOptions()"
      (chartClick)="handleChartClick($event)"
      role="img"
      aria-label="Daily total and 30 day average trend. Select a bar to open that day.">
    </div>
  `,
  styles: [`
    .daily-chart { width: 100%; height: min(44vh, 560px); min-height: 360px; }
  `],
})
export class DailyLogTrendComponent {
  readonly rows = input<DailySummaryRow[]>([]);
  readonly openDay = output<string>();
  readonly chartOptions = computed(() => dailyLogChartOptions(this.rows()));

  handleChartClick(event: { seriesType?: string; dataIndex?: number }): void {
    if (event.seriesType !== 'bar' || !Number.isInteger(event.dataIndex)) return;
    const row = dailyLogRowAtChartIndex(this.rows(), event.dataIndex!);
    if (row) this.openDay.emit(row.metric_date);
  }
}
