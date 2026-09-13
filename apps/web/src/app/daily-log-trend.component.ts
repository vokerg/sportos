import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { DailySummaryRow } from './api.service';
import { dailyLogChartOptions } from './daily-log.view-model';

@Component({
  selector: 'sportos-daily-log-trend',
  standalone: true,
  imports: [DecimalPipe, NgxEchartsDirective],
  template: `
    <div class="kpi-row">
      <div class="kpi"><div class="label">Rows</div><div class="value">{{ rows().length }}</div></div>
      <div class="kpi"><div class="label">Latest total</div><div class="value">{{ latest()?.total_points ?? '—' }}</div></div>
      <div class="kpi"><div class="label">Latest 30d avg</div><div class="value">{{ latest()?.avg_30d ? (latest()!.avg_30d | number:'1.0-0') : '—' }}</div></div>
      <div class="kpi"><div class="label">Excel delta</div><div class="value">{{ latest()?.points_delta_vs_excel ?? '—' }}</div></div>
    </div>

    <div
      class="daily-chart"
      echarts
      [options]="chartOptions()"
      role="img"
      aria-label="Daily total and 30 day average trend">
    </div>
  `,
  styles: [`
    .daily-chart { width: 100%; height: min(44vh, 560px); min-height: 360px; }
  `],
})
export class DailyLogTrendComponent {
  readonly rows = input<DailySummaryRow[]>([]);
  readonly latest = computed(() => this.rows()[0]);
  readonly chartOptions = computed(() => dailyLogChartOptions(this.rows()));
}
