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
    ScoreBreakdownPanelComponent,
  ],
  template: `
    <section class="card" aria-labelledby="daily-log-title">
      <h2 id="daily-log-title">Daily Log</h2>
      <p class="daily-log-help">Imported workbook ledger totals are authoritative until you explicitly recalculate a day. Use <strong>View details</strong> to inspect the score, activities, raw source rows, and the Excel reference.</p>

      <form class="filter-bar" (submit)="applyFilters(); $event.preventDefault()" aria-label="Daily Log date range">
        <label>From <input type="date" [value]="from()" (input)="from.set($any($event.target).value)" /></label>
        <label>To <input type="date" [value]="to()" (input)="to.set($any($event.target).value)" /></label>
        <button type="submit" [disabled]="summaryState() === 'loading'">Apply range</button>
        <button type="button" class="secondary" (click)="resetFilters()">Reset</button>
      </form>

      <div class="activity-recalculation">
        <div>
          <span class="recalculation-label">Explicit recalculation</span>
          <strong>Calculate a date from Strava activities</strong>
          <small>Use this when a daily ledger row is missing. Existing imported rows can also be recalculated from the details panel.</small>
        </div>
        <label>Date <input type="date" [value]="activityDate()" (input)="activityDate.set($any($event.target).value)" /></label>
        <button type="button" [disabled]="recalculationState() === 'working' || !activityDate()" (click)="recalculateSelectedDate(activityDate())">
          Calculate from Strava
        </button>
        @if (recalculationError()) {
          <p class="recalculation-error" role="alert">{{ recalculationError() }}</p>
        }
      </div>

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

        <div class="daily-chart" echarts [options]="chartOptions()" role="img" aria-label="Daily total and 30 day average trend"></div>

        <ag-grid-angular
          class="ag-theme-quartz daily-grid"
          aria-label="Daily scores. Use the View details action in a row to view canonical facts and source provenance."
          [rowData]="rows()"
          [columnDefs]="columnDefs"
          [defaultColDef]="defaultColDef"
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
        [recalculating]="recalculationState() === 'working'"
        [recalculationError]="recalculationError()"
        (retry)="retryBreakdown()"
        (recalculate)="recalculateSelectedDate()"
        (closed)="closeBreakdown()" />
    </section>
  `,
  styles: [`
    .daily-log-help { margin: -6px 0 16px; color: #667085; font-size: 13px; }
    .activity-recalculation { display: flex; align-items: end; gap: 14px; margin: 16px 0 20px; padding: 14px; border: 1px solid #dbe4f0; border-radius: 12px; background: #f8faff; }
    .activity-recalculation > div:first-child { display: grid; gap: 4px; min-width: 0; flex: 1; }
    .activity-recalculation strong { color: #243b73; font-size: 14px; }
    .activity-recalculation small { color: #667085; font-size: 12px; line-height: 1.4; }
    .recalculation-label { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
    .recalculation-error { flex-basis: 100%; margin: 0; color: #b54747; font-size: 12px; }
    .daily-chart { width: 100%; height: min(44vh, 560px); min-height: 360px; }
    .daily-grid { width: 100%; height: min(62vh, 720px); min-height: 480px; margin-top: 18px; }
    @media (max-width: 760px) { .activity-recalculation { align-items: stretch; flex-direction: column; } }
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
  readonly activityDate = signal('');
  readonly breakdownState = signal<ScoreBreakdownViewState>('idle');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly breakdownError = signal<string | null>(null);
  readonly recalculationState = signal<'idle' | 'working'>('idle');
  readonly recalculationError = signal<string | null>(null);

  private summarySubscription?: Subscription;
  private breakdownSubscription?: Subscription;
  private recalculationSubscription?: Subscription;

  readonly gridContext: DailyBreakdownGridContext = {
    openBreakdown: (row) => this.openBreakdown(row),
  };

  readonly defaultColDef: ColDef<DailySummaryRow> = {
    sortable: true,
    resizable: true,
    filter: true,
    minWidth: 112,
    flex: 1,
  };

  readonly columnDefs: ColDef<DailySummaryRow>[] = [
    { colId: 'scoreBreakdown', headerName: 'Details', cellRenderer: DailyBreakdownButtonComponent, pinned: 'left', width: 124, minWidth: 124, maxWidth: 124, sortable: false, filter: false, suppressHeaderMenuButton: true },
    { field: 'metric_date', headerName: 'Date', pinned: 'left', width: 130, minWidth: 130, flex: 0 },
    { field: 'score_status', headerName: 'Authority', valueFormatter: (params) => this.scoreStatusLabel(params.value) },
    { field: 'steps', headerName: 'Steps', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
    { field: 'run_m', headerName: 'Run', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatMeters(params.value) },
    { field: 'bike_m', headerName: 'Bike', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatMeters(params.value) },
    { field: 'swim_m', headerName: 'Swim', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatMeters(params.value, 0) },
    { field: 'workout_points', headerName: 'Workout', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
    { field: 'power_points', headerName: 'Power', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
    { field: 'base_points', headerName: 'Base', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
    { field: 'bonus_points', headerName: 'Bonus', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
    { field: 'total_points', headerName: 'SportOS total', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
    { field: 'excel_all_points', headerName: 'Excel All', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
    { field: 'points_delta_vs_excel', headerName: 'Δ vs Excel', filter: 'agNumberColumnFilter', valueFormatter: (params) => this.formatCellNumber(params.value) },
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
    this.recalculationSubscription?.unsubscribe();
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
    this.loadSummaryRows();
  }

  private loadSummaryRows(): void {
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

  recalculateSelectedDate(date?: string): void {
    const targetDate = (date ?? this.selectedDate() ?? '').trim();
    if (!targetDate) {
      this.recalculationError.set('Choose a date before recalculating from Strava.');
      return;
    }

    const keepCurrentBreakdown = this.breakdown()?.date === targetDate;
    this.recalculationSubscription?.unsubscribe();
    this.selectedDate.set(targetDate);
    this.recalculationState.set('working');
    this.recalculationError.set(null);
    if (!keepCurrentBreakdown) {
      this.breakdown.set(null);
      this.breakdownError.set(null);
      this.breakdownState.set('loading');
    }

    this.recalculationSubscription = this.scoreBreakdownApi.recalculate(targetDate).subscribe({
      next: (result) => {
        this.breakdown.set(result);
        this.breakdownError.set(null);
        this.breakdownState.set('loaded');
        this.recalculationState.set('idle');
        this.recalculationError.set(null);
        this.loadSummaryRows();
      },
      error: (error: unknown) => {
        this.recalculationState.set('idle');
        const message = this.describeRecalculationError(error);
        this.recalculationError.set(message);
        if (!keepCurrentBreakdown) {
          this.breakdownError.set(message);
          this.breakdownState.set('error');
        }
      },
    });
  }

  retryBreakdown(): void {
    const date = this.selectedDate();
    if (date) this.loadBreakdown(date);
  }

  closeBreakdown(): void {
    this.breakdownSubscription?.unsubscribe();
    this.recalculationSubscription?.unsubscribe();
    this.recalculationState.set('idle');
    this.selectedDate.set(null);
    this.breakdown.set(null);
    this.breakdownError.set(null);
    this.recalculationError.set(null);
    this.breakdownState.set('idle');
  }

  private loadBreakdown(date: string): void {
    this.breakdownSubscription?.unsubscribe();
    this.recalculationSubscription?.unsubscribe();
    this.recalculationState.set('idle');
    this.recalculationError.set(null);
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

  private describeRecalculationError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The recalculation request failed unexpectedly.';
    const body = this.apiErrorBody(error.error);
    if (body?.code === 'STRAVA_DATA_UNAVAILABLE' || error.status === 409) return body?.message || 'No Strava activity is available for the selected date.';
    if (body?.code === 'INVALID_DATE' || error.status === 400) return body?.message || 'The selected date is invalid.';
    if (body?.code === 'SCORE_BREAKDOWN_INCONSISTENT') return 'The recalculated score failed consistency checks.';
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The recalculation API returned HTTP ${error.status}.`;
  }

  private apiErrorBody(value: unknown): ApiErrorBody | null {
    if (!value || typeof value !== 'object') return null;
    return value as ApiErrorBody;
  }

  private formatCellNumber(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number) : String(value);
  }

  private formatMeters(value: unknown, fractionDigits = 2): string {
    if (value === null || value === undefined || value === '') return '—';
    const meters = Number(value);
    return Number.isFinite(meters)
      ? `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: fractionDigits })} km`
      : String(value);
  }

  scoreStatusLabel(value: unknown): string {
    return value === 'imported' ? 'Imported ledger' : value === 'calculated' ? 'Calculated' : String(value ?? '—');
  }
}
