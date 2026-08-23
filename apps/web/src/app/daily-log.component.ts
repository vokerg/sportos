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

type SummaryState = 'loading' | 'loaded' | 'empty' | 'error';

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
    <section class="card" aria-labelledby="daily-log-title">
      <h2 id="daily-log-title">Daily Log</h2>
      <p class="daily-log-help">Filter canonical daily facts, then use <strong>View details</strong> to trace a total through ledger entries, activities, source rows, and import batches.</p>

      <form class="filter-bar" (submit)="applyFilters(); $event.preventDefault()" aria-label="Daily Log date range">
        <label>From <input type="date" [value]="from()" (input)="from.set($any($event.target).value)" /></label>
        <label>To <input type="date" [value]="to()" (input)="to.set($any($event.target).value)" /></label>
        <button type="submit" [disabled]="summaryState() === 'loading'">Apply range</button>
        <button type="button" class="secondary" (click)="resetFilters()">Reset</button>
      </form>

      @if (summaryState() === 'loading') {
        <p role="status" aria-live="polite">Loading daily summaries…</p>
      } @else if (summaryState() === 'error') {
        <div class="state-message error" role="alert">
          <p>{{ summaryError() }}</p>
          <button type="button" (click)="loadRows()">Retry</button>
        </div>
      } @else if (summaryState() === 'empty') {
        <p class="state-message" role="status">No canonical daily summaries match this range.</p>
      } @else {
        <div class="kpi-row">
          <div class="kpi"><div class="label">Rows</div><div class="value">{{ rows().length }}</div></div>
          <div class="kpi"><div class="label">Latest total</div><div class="value">{{ latest()?.total_points ?? '—' }}</div></div>
          <div class="kpi"><div class="label">Latest 30d avg</div><div class="value">{{ latest()?.avg_30d ? (latest()!.avg_30d | number:'1.0-0') : '—' }}</div></div>
          <div class="kpi"><div class="label">Excel delta</div><div class="value">{{ latest()?.points_delta_vs_excel ?? '—' }}</div></div>
        </div>

        <div echarts [options]="chartOptions()" style="height: 320px;" role="img" aria-label="Daily total and 30 day average trend"></div>

        <ag-grid-angular
          class="ag-theme-quartz"
          style="width: 100%; height: 460px; margin-top: 16px;"
          aria-label="Daily scores. Use the View details action in a row to view canonical facts and source provenance."
          [rowData]="rows()"
          [columnDefs]="columnDefs"
          [context]="gridContext"
          [pagination]="true"
          [paginationPageSize]="25">
        </ag-grid-angular>
      }

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
    .daily-log-help { margin: -6px 0 16px; color: #667085; font-size: 13px; }
  `],
})
export class DailyLogComponent implements OnInit, OnDestroy {
  readonly rows = signal<DailySummaryRow[]>([]);
  readonly latest = computed(() => this.rows()[0]);
  readonly from = signal('');
  readonly to = signal('');
  readonly summaryState = signal<SummaryState>('loading');
  readonly summaryError = signal<string | null>(null);
  readonly selectedDate = signal<string | null>(null);
  readonly breakdownState = signal<ScoreBreakdownViewState>('idle');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly breakdownError = signal<string | null>(null);

  private summarySubscription?: Subscription;
  private breakdownSubscription?: Subscription;

  readonly gridContext: DailyBreakdownGridContext = {
    openBreakdown: (row) => this.openBreakdown(row),
  };

  readonly columnDefs: ColDef<DailySummaryRow>[] = [
    { colId: 'scoreBreakdown', headerName: 'Details', cellRenderer: DailyBreakdownButtonComponent, pinned: 'left', width: 108, minWidth: 108, maxWidth: 108, sortable: false, filter: false, suppressHeaderMenuButton: true },
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

  ngOnInit(): void { this.loadRows(); }

  ngOnDestroy(): void {
    this.summarySubscription?.unsubscribe();
    this.breakdownSubscription?.unsubscribe();
  }

  applyFilters(): void {
    this.closeBreakdown();
    if (this.from() && this.to() && this.from() > this.to()) {
      this.summaryError.set('From date must be on or before the to date.');
      this.summaryState.set('error');
      return;
    }
    this.loadRows();
  }

  resetFilters(): void {
    this.from.set('');
    this.to.set('');
    this.loadRows();
  }

  loadRows(): void {
    this.closeBreakdown();
    this.summarySubscription?.unsubscribe();
    this.summaryState.set('loading');
    this.summaryError.set(null);
    this.summarySubscription = this.api.dailySummary({
      from: this.from() || undefined,
      to: this.to() || undefined,
      limit: 2000,
    }).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.summaryState.set(rows.length === 0 ? 'empty' : 'loaded');
      },
      error: (error: unknown) => {
        this.rows.set([]);
        this.summaryError.set(this.describeSummaryError(error));
        this.summaryState.set('error');
      },
    });
  }

  openBreakdown(row: DailySummaryRow): void { this.openBreakdownForDate(row.metric_date); }
  openBreakdownForDate(date: string): void { this.loadBreakdown(date); }

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
      next: (result) => { this.breakdown.set(result); this.breakdownState.set('loaded'); },
      error: (error: unknown) => { this.breakdownError.set(this.describeBreakdownError(error)); this.breakdownState.set('error'); },
    });
  }

  private describeSummaryError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The daily summary request failed unexpectedly.';
    const body = this.apiErrorBody(error.error);
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The daily summary API returned HTTP ${error.status}.`;
  }

  private describeBreakdownError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The score-breakdown request failed unexpectedly.';
    const body = this.apiErrorBody(error.error);
    if (body?.code === 'DAILY_SCORE_NOT_FOUND' || error.status === 404) return body?.message || 'No persisted score exists for the selected date.';
    if (body?.code === 'INVALID_DATE' || error.status === 400) return body?.message || 'The selected date is invalid.';
    if (body?.code === 'SCORE_BREAKDOWN_INCONSISTENT') return 'The persisted score failed consistency checks. Review the import and ledger data before using this total.';
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The API returned HTTP ${error.status}.`;
  }

  private apiErrorBody(value: unknown): ApiErrorBody | null {
    if (!value || typeof value !== 'object') return null;
    return value as ApiErrorBody;
  }
}
