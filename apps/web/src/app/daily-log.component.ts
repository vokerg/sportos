import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService, type DailySummaryRow } from './api.service';
import { DailyLogActionsComponent } from './daily-log-actions.component';
import { DailyLogFiltersComponent } from './daily-log-filters.component';
import { DailyLogGridComponent } from './daily-log-grid.component';
import { DailyLogTrendComponent } from './daily-log-trend.component';
import {
  DEFAULT_QUICK_RANGE,
  QUICK_RANGE_VALUES,
  type DailyLogSummaryState,
  type QuickRange,
  quickRangeDates,
} from './daily-log.view-model';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import { DailyQuickSheetComponent } from './daily-quick-sheet.component';
import type {
  ApiErrorBody,
  DailyScoreBreakdown,
  ManualDailyFactsInput,
  ScoreBreakdownViewState,
} from './score-breakdown.models';

@Component({
  selector: 'sportos-daily-log',
  standalone: true,
  imports: [
    DailyLogFiltersComponent,
    DailyLogActionsComponent,
    DailyLogTrendComponent,
    DailyLogGridComponent,
    DailyQuickSheetComponent,
  ],
  template: `
    <section class="card" aria-labelledby="daily-log-title">
      <h2 id="daily-log-title">Daily Log</h2>
      <p class="daily-log-help">A day can be authoritative from an imported workbook ledger, calculated activities, or saved manual facts. Use <strong>View details</strong> to inspect and edit it without losing prior provenance.</p>

      <sportos-daily-log-filters
        [quickRange]="quickRange()"
        [from]="from()"
        [to]="to()"
        [loading]="summaryState() === 'loading'"
        (quickRangeChange)="setQuickRange($event)"
        (fromChange)="setFrom($event)"
        (toChange)="setTo($event)"
        (apply)="applyFilters()"
        (reset)="resetFilters()" />

      <sportos-daily-log-actions
        [date]="activityDate()"
        [working]="recalculationState() === 'working'"
        [errorMessage]="recalculationError()"
        (dateChange)="activityDate.set($event)"
        (recalculate)="recalculateSelectedDate(activityDate())"
        (manualEntry)="openManualEntry(activityDate())" />

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
        <sportos-daily-log-trend [rows]="rows()" />
        <sportos-daily-log-grid [rows]="rows()" (openBreakdown)="openBreakdown($event)" />
      }

      <sportos-daily-quick-sheet
        [state]="breakdownState()"
        [date]="selectedDate()"
        [breakdown]="breakdown()"
        [errorMessage]="breakdownError()"
        [recalculating]="recalculationState() === 'working'"
        [recalculationError]="recalculationError()"
        [savingManual]="manualSaveState() === 'working'"
        [manualSaveError]="manualSaveError()"
        [manualEditRequestId]="manualEditRequestId()"
        (retry)="retryBreakdown()"
        (recalculate)="recalculateSelectedDate()"
        (saveManualFacts)="saveManualFacts($event)"
        (opened)="openFullDay()"
        (closed)="closeBreakdown()" />
    </section>
  `,
  styles: [`
    .daily-log-help { margin: -6px 0 16px; color: #667085; font-size: 13px; }
  `],
})
export class DailyLogComponent implements OnInit, OnDestroy {
  readonly rows = signal<DailySummaryRow[]>([]);
  readonly from = signal(quickRangeDates(DEFAULT_QUICK_RANGE).from);
  readonly to = signal(quickRangeDates(DEFAULT_QUICK_RANGE).to);
  readonly quickRange = signal<QuickRange>(DEFAULT_QUICK_RANGE);
  readonly summaryState = signal<DailyLogSummaryState>('loading');
  readonly summaryError = signal<string | null>(null);
  readonly selectedDate = signal<string | null>(null);
  readonly activityDate = signal('');
  readonly breakdownState = signal<ScoreBreakdownViewState>('idle');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly breakdownError = signal<string | null>(null);
  readonly recalculationState = signal<'idle' | 'working'>('idle');
  readonly recalculationError = signal<string | null>(null);
  readonly manualSaveState = signal<'idle' | 'working'>('idle');
  readonly manualSaveError = signal<string | null>(null);
  readonly manualEditRequestId = signal(0);

  private readonly destroy$ = new Subject<void>();
  private readonly summaryRequestCancelled$ = new Subject<void>();
  private readonly breakdownRequestCancelled$ = new Subject<void>();
  private readonly recalculationRequestCancelled$ = new Subject<void>();
  private readonly manualSaveRequestCancelled$ = new Subject<void>();

  constructor(
    private readonly api: ApiService,
    private readonly scoreBreakdownApi: ScoreBreakdownApiService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.loadRows();
  }

  ngOnDestroy(): void {
    this.summaryRequestCancelled$.next();
    this.breakdownRequestCancelled$.next();
    this.recalculationRequestCancelled$.next();
    this.manualSaveRequestCancelled$.next();
    this.destroy$.next();
    this.destroy$.complete();
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

  setFrom(value: string): void {
    this.from.set(value);
    this.quickRange.set('custom');
  }

  setTo(value: string): void {
    this.to.set(value);
    this.quickRange.set('custom');
  }

  setQuickRange(value: string): void {
    if (!QUICK_RANGE_VALUES.includes(value as QuickRange)) return;
    const range = value as QuickRange;
    this.quickRange.set(range);
    if (range === 'custom') return;

    const dates = quickRangeDates(range);
    this.from.set(dates.from);
    this.to.set(dates.to);
    this.applyFilters();
  }

  resetFilters(): void {
    const dates = quickRangeDates(DEFAULT_QUICK_RANGE);
    this.from.set(dates.from);
    this.to.set(dates.to);
    this.quickRange.set(DEFAULT_QUICK_RANGE);
    this.loadRows();
  }

  loadRows(): void {
    this.closeBreakdown();
    this.loadSummaryRows();
  }

  openBreakdown(row: DailySummaryRow): void {
    this.openBreakdownForDate(row.metric_date);
  }

  openBreakdownForDate(date: string): void {
    this.loadBreakdown(date);
  }

  openManualEntry(date: string): void {
    if (!date) return;
    this.manualSaveError.set(null);
    this.manualEditRequestId.update((requestId) => requestId + 1);
    this.loadBreakdown(date, true);
  }

  openFullDay(edit = false): void {
    const date = this.selectedDate();
    if (!date) return;
    void this.router.navigate(['/daily', date], {
      queryParams: edit ? { edit: 'true' } : undefined,
    });
  }

  saveManualFacts(input: ManualDailyFactsInput): void {
    const date = this.selectedDate();
    if (!date) return;

    this.manualSaveRequestCancelled$.next();
    this.manualSaveState.set('working');
    this.manualSaveError.set(null);
    this.scoreBreakdownApi.saveManualFacts(date, input)
      .pipe(
        takeUntil(this.manualSaveRequestCancelled$),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (result) => {
          this.breakdown.set(result);
          this.breakdownState.set('loaded');
          this.manualSaveState.set('idle');
          this.loadSummaryRows();
        },
        error: (error: unknown) => {
          this.manualSaveState.set('idle');
          this.manualSaveError.set(this.describeManualSaveError(error));
        },
      });
  }

  recalculateSelectedDate(date?: string): void {
    const targetDate = (date ?? this.selectedDate() ?? '').trim();
    if (!targetDate) {
      this.recalculationError.set('Choose a date before recalculating from Strava.');
      return;
    }

    const keepCurrentBreakdown = this.breakdown()?.date === targetDate;
    this.recalculationRequestCancelled$.next();
    this.selectedDate.set(targetDate);
    this.recalculationState.set('working');
    this.recalculationError.set(null);
    if (!keepCurrentBreakdown) {
      this.breakdown.set(null);
      this.breakdownError.set(null);
      this.breakdownState.set('loading');
    }

    this.scoreBreakdownApi.recalculate(targetDate)
      .pipe(
        takeUntil(this.recalculationRequestCancelled$),
        takeUntil(this.destroy$),
      )
      .subscribe({
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
    this.breakdownRequestCancelled$.next();
    this.recalculationRequestCancelled$.next();
    this.manualSaveRequestCancelled$.next();
    this.recalculationState.set('idle');
    this.manualSaveState.set('idle');
    this.selectedDate.set(null);
    this.breakdown.set(null);
    this.breakdownError.set(null);
    this.recalculationError.set(null);
    this.manualSaveError.set(null);
    this.breakdownState.set('idle');
  }

  private loadSummaryRows(): void {
    this.summaryRequestCancelled$.next();
    this.summaryState.set('loading');
    this.summaryError.set(null);
    this.api.dailySummary({
      from: this.from() || undefined,
      to: this.to() || undefined,
      limit: 10_000,
    })
      .pipe(
        takeUntil(this.summaryRequestCancelled$),
        takeUntil(this.destroy$),
      )
      .subscribe({
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

  private loadBreakdown(date: string, allowMissing = false): void {
    this.breakdownRequestCancelled$.next();
    this.recalculationRequestCancelled$.next();
    this.manualSaveRequestCancelled$.next();
    this.recalculationState.set('idle');
    this.manualSaveState.set('idle');
    this.recalculationError.set(null);
    this.manualSaveError.set(null);
    this.selectedDate.set(date);
    this.breakdown.set(null);
    this.breakdownError.set(null);
    this.breakdownState.set('loading');

    this.scoreBreakdownApi.getForDate(date)
      .pipe(
        takeUntil(this.breakdownRequestCancelled$),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (result) => {
          this.breakdown.set(result);
          this.breakdownState.set('loaded');
        },
        error: (error: unknown) => {
          if (allowMissing && this.isMissingBreakdown(error)) {
            this.breakdown.set(null);
            this.breakdownError.set(null);
            this.breakdownState.set('loaded');
            return;
          }
          this.breakdownError.set(this.describeBreakdownError(error));
          this.breakdownState.set('error');
        },
      });
  }

  private isMissingBreakdown(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse)) return false;
    return error.status === 404 || this.apiErrorBody(error.error)?.code === 'DAILY_SCORE_NOT_FOUND';
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

  private describeManualSaveError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The manual facts request failed unexpectedly.';
    const body = this.apiErrorBody(error.error);
    if (body?.code === 'INVALID_MANUAL_DAILY_FACTS' || body?.code === 'INVALID_DATE' || error.status === 400) {
      return body?.message || 'The manual facts are invalid.';
    }
    if (body?.code === 'SCORE_BREAKDOWN_INCONSISTENT') return 'The manually saved score failed consistency checks.';
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The manual facts API returned HTTP ${error.status}.`;
  }

  private apiErrorBody(value: unknown): ApiErrorBody | null {
    if (!value || typeof value !== 'object') return null;
    return value as ApiErrorBody;
  }
}
