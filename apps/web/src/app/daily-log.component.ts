import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef } from 'ag-grid-community';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { ApiService, type DailySummaryRow } from './api.service';

@Component({
  selector: 'sportos-daily-log',
  standalone: true,
  imports: [AgGridAngular, NgxEchartsDirective, DecimalPipe],
  template: `
    <section class="card">
      <h2>Daily Log</h2>
      <div class="kpi-row">
        <div class="kpi"><div class="label">Rows</div><div class="value">{{ rows().length }}</div></div>
        <div class="kpi"><div class="label">Latest total</div><div class="value">{{ latest()?.total_points ?? '—' }}</div></div>
        <div class="kpi"><div class="label">Latest 30d avg</div><div class="value">{{ latest()?.avg_30d ? (latest()!.avg_30d | number:'1.0-0') : '—' }}</div></div>
        <div class="kpi"><div class="label">Excel delta</div><div class="value">{{ latest()?.points_delta_vs_excel ?? '—' }}</div></div>
      </div>

      <div echarts [options]="chartOptions()" style="height: 320px;"></div>

      <ag-grid-angular
        class="ag-theme-quartz"
        style="width: 100%; height: 460px; margin-top: 16px;"
        [rowData]="rows()"
        [columnDefs]="columnDefs"
        [pagination]="true"
        [paginationPageSize]="25">
      </ag-grid-angular>
    </section>
  `,
})
export class DailyLogComponent implements OnInit {
  readonly rows = signal<DailySummaryRow[]>([]);
  readonly latest = computed(() => this.rows()[0]);

  readonly columnDefs: ColDef<DailySummaryRow>[] = [
    { field: 'metric_date', headerName: 'Date', pinned: 'left', filter: true },
    { field: 'steps', filter: 'agNumberColumnFilter' },
    { field: 'run_m', headerName: 'Run m', filter: 'agNumberColumnFilter' },
    { field: 'bike_m', headerName: 'Bike m', filter: 'agNumberColumnFilter' },
    { field: 'swim_m', headerName: 'Swim m', filter: 'agNumberColumnFilter' },
    { field: 'workout_points', headerName: 'WO', filter: 'agNumberColumnFilter' },
    { field: 'power_points', headerName: 'Pow', filter: 'agNumberColumnFilter' },
    { field: 'base_points', headerName: 'Base', filter: 'agNumberColumnFilter' },
    { field: 'bonus_points', headerName: 'Bonus', filter: 'agNumberColumnFilter' },
    { field: 'total_points', headerName: 'Total', filter: 'agNumberColumnFilter' },
    { field: 'excel_all_points', headerName: 'Excel total', filter: 'agNumberColumnFilter' },
    { field: 'points_delta_vs_excel', headerName: 'Δ vs Excel', filter: 'agNumberColumnFilter' },
  ];

  readonly chartOptions = computed<EChartsCoreOption>(() => {
    const chronological = [...this.rows()].reverse().slice(-120);
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0 },
      grid: { left: 45, right: 20, top: 20, bottom: 55 },
      xAxis: { type: 'category', data: chronological.map((r) => r.metric_date) },
      yAxis: { type: 'value' },
      series: [
        { name: 'Total points', type: 'bar', data: chronological.map((r) => r.total_points) },
        { name: '30d average', type: 'line', data: chronological.map((r) => Math.round(r.avg_30d ?? 0)) },
      ],
    };
  });

  constructor(private readonly api: ApiService) {}

  ngOnInit() {
    this.api.dailySummary().subscribe((rows) => this.rows.set(rows));
  }
}
