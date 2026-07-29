import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef } from 'ag-grid-community';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsCoreOption } from 'echarts/core';
import { Subscription } from 'rxjs';
import { ApiService, type DailySummaryRow } from './api.service';
import {
  DailyBreakdownButtonComponent,
  type DailyBreakdownGridContext,
} from './daily-breakdown-button.component';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import {
  ScoreBreakdownPanelComponent,
  type ScoreBreakdownViewState,
} from './score-breakdown-panel.component';
import type { ApiErrorBody, DailyScoreBreakdown } from './score-breakdown.models';

@Component({
  selector: 'sportos-daily-log',
  standalone: true,
  imports: [
    AgGridAngular,
    NgxEchartsDirective,
    DecimalPipe,
    DailyBreakdownButtonComponent,
    ScoreBreakdownPanelComponent,
  ],
  template: `
    <section class="card">
      <h2>Daily Log</h2>
      <p class="daily-log-help">Use <strong>Explain</strong> on any row to reconcile the persisted app score with the imported spreadsheet total.</p>
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
        aria-label="Daily scores. Use the Explain action in a row to view its persisted score breakdown."
        [rowData]="rows()"
        [columnDefs]="columnDefs"
        [context]="gridContext"
        [pagination]="true"
        [paginationPageSize]="25">
      </ag-grid-angular>

      <sportos-score-breakdown-panel
        [state]="breakdownState()"
        [date]="selectedDate()"
        [breakdown]="breakdown()"
        [errorMessage]="breakdownError()"
        (retry)="retryBreakdown()"
        (closed)="closeBreakdown()" />
    </section>
  `,
  styles: [`
    .daily-log-help {
      margin: -6px 0 16px;
      color: #667085;
      font-size: 13px;
    }
  `],
})
export class DailyLogComponent implements OnInit, OnDestroy {
  readonly rows = signal<DailySummaryRow[]>([]);
  readonly latest = computed(() => this.rows()[0]);
  readonly selectedDate = signal<string | null>(null);
  readonly breakdownState = signal<ScoreBreakdownViewState>('idle');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly breakdownError = signal<string | null>(null);

  private breakdownSubscription?: Subscription;

  readonly gridContext: DailyBreakdownGridContext = {
    openBreakdown: (row) => this.openBreakdown(row),
  };

  readonly columnDefs: ColDef<DailySummaryRow>[] = [
    {
      colId: 'scoreBreakdown',
      headerName: 'Details',
      cellRenderer: DailyBreakdownButtonComponent,
      pinned: 'left',
      width: 108,
      minWidth: 108,
      maxWidth: 108,
      sortable: false,
      filter: false,
      suppressHeaderMenuButton: true,
    },
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

  constructor(
    private readonly api: ApiService,
    private readonly scoreBreakdownApi: ScoreBreakdownApiService,
  ) {}

  ngOnInit(): void {
    this.api.dailySummary().subscribe((rows) => this.rows.set(rows));
  }

  ngOnDestroy(): void {
    this.breakdownSubscription?.unsubscribe();
  }

  openBreakdown(row: DailySummaryRow): void {
    this.loadBreakdown(row.metric_date);
  }

  retryBreakdown(): void {
    const date = this.selectedDate();
    if (date) this.loadBreakdown(date);
  }

  closeBreakdown(): void {
    this.breakdownSubscription?.unsubscribe();
    this.selectedDate.set(null);
    this.breakdown.set(null);
    this.breakdownError.set(null);
    this.breakdownState.set('idle');
  }

  private loadBreakdown(date: string): void {
    this.breakdownSubscription?.unsubscribe();
    this.selectedDate.set(date);
    this.breakdown.set(null);
    this.breakdownError.set(null);
    this.breakdownState.set('loading');

    this.breakdownSubscription = this.scoreBreakdownApi.getForDate(date).subscribe({
      next: (result) => {
        this.breakdown.set(result);
        this.breakdownState.set('loaded');
      },
      error: (error: unknown) => {
        this.breakdownError.set(this.describeBreakdownError(error));
        this.breakdownState.set('error');
      },
    });
  }

  private describeBreakdownError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The score-breakdown request failed unexpectedly.';
    const body = this.apiErrorBody(error.error);
    if (body?.code === 'DAILY_SCORE_NOT_FOUND' || error.status === 404) {
      return body?.message || 'No persisted score exists for the selected date.';
    }
    if (body?.code === 'INVALID_DATE' || error.status === 400) {
      return body?.message || 'The selected date is invalid.';
    }
    if (body?.code === 'SCORE_BREAKDOWN_INCONSISTENT') {
      return 'The persisted score failed consistency checks. Review the import and ledger data before using this total.';
    }
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The API returned HTTP ${error.status}.`;
  }

  private apiErrorBody(value: unknown): ApiErrorBody | null {
    if (!value || typeof value !== 'object') return null;
    return value as ApiErrorBody;
  }
}
