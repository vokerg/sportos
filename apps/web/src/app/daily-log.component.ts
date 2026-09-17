import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService, type DailySummaryRow } from './api.service';
import { DailyLogActionsComponent } from './daily-log-actions.component';
import { DailyLogFiltersComponent } from './daily-log-filters.component';
import { DailyLogGridComponent } from './daily-log-grid.component';
import { DailyLogTrendComponent } from './daily-log-trend.component';
import { DailyQuickEntryGridComponent, type DailyQuickEntryChange, type DailyQuickEntryGridRow } from './daily-quick-entry-grid.component';
import {
  DEFAULT_QUICK_RANGE,
  QUICK_RANGE_VALUES,
  type DailyLogSummaryState,
  type QuickRange,
  quickRangeDates,
} from './daily-log.view-model';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import { DailyQuickSheetComponent } from './daily-quick-sheet.component';
import { ProviderApiService, type ProviderConnection, type ProviderSyncJob } from './provider-api.service';
import { stravaCalendarDateWindow } from './strava-day-refresh';
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
    DailyQuickEntryGridComponent,
    DailyQuickSheetComponent,
  ],
  template: `
    <section class="card" aria-labelledby="daily-log-title">
      <h2 id="daily-log-title">Daily Log</h2>
      <p class="daily-log-help">A day can be authoritative from an imported workbook ledger, calculated activities, or saved manual facts. Open a row to inspect and edit it without losing prior provenance.</p>

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
        (manualEntry)="openManualEntry(activityDate())"
        (quickEntry)="addQuickEntryDate(activityDate())" />

      <div class="view-switch" role="group" aria-label="Daily log view">
        <button type="button" [class.active]="viewMode() === 'summary'" (click)="showSummary()">Summary</button>
        <button type="button" [class.active]="viewMode() === 'quick-entry'" (click)="showQuickEntry()">Quick entry</button>
      </div>

      @if (viewMode() === 'summary') {
        @if (summaryState() === 'loading') {
          <p role="status" aria-live="polite">Loading daily summaries…</p>
        } @else if (summaryState() === 'error') {
          <div class="state-message error" role="alert"><p>{{ summaryError() }}</p><button type="button" (click)="loadRows()">Retry</button></div>
        } @else if (summaryState() === 'empty') {
          <p class="state-message" role="status">No canonical daily summaries match this range.</p>
        } @else {
          <sportos-daily-log-trend [rows]="rows()" />
          <sportos-daily-log-grid [rows]="rows()" (openBreakdown)="openBreakdown($event)" />
        }
      } @else {
        @if (quickEntryState() === 'loading') {
          <p role="status">Loading editable facts…</p>
        } @else if (quickEntryState() === 'error') {
          <div class="state-message error" role="alert"><p>{{ quickEntryError() }}</p><button type="button" (click)="loadQuickEntryRows()">Retry</button></div>
        } @else {
          <sportos-daily-quick-entry-grid
            [rows]="quickEntryRows()"
            (save)="saveQuickEntry($event)"
            (refreshFromStrava)="refreshQuickEntryFromStrava($event)" />
        }
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
    .view-switch { display: flex; gap: 4px; width: fit-content; padding: 4px; border: 1px solid #dbe4f0; border-radius: 10px; background: #f8fafc; }
    .view-switch button { border-color: transparent; background: transparent; color: #667085; }
    .view-switch button.active { border-color: #b8c8ed; background: #fff; color: #243b73; box-shadow: 0 1px 2px rgba(16, 24, 40, .08); }
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
  readonly viewMode = signal<'summary' | 'quick-entry'>('summary');
  readonly quickEntryRows = signal<DailyQuickEntryGridRow[]>([]);
  readonly quickEntryState = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  readonly quickEntryError = signal<string | null>(null);
  readonly stravaConnection = signal<ProviderConnection | null>(null);

  private readonly destroy$ = new Subject<void>();
  private readonly summaryRequestCancelled$ = new Subject<void>();
  private readonly breakdownRequestCancelled$ = new Subject<void>();
  private readonly recalculationRequestCancelled$ = new Subject<void>();
  private readonly manualSaveRequestCancelled$ = new Subject<void>();
  private quickEntryRefreshSubscription?: { unsubscribe(): void };
  private quickEntryPollTimer?: ReturnType<typeof setTimeout>;
  private quickEntryPollCount = 0;

  constructor(
    private readonly api: ApiService,
    private readonly scoreBreakdownApi: ScoreBreakdownApiService,
    private readonly router: Router,
    private readonly providerApi: ProviderApiService,
  ) {}

  ngOnInit(): void {
    this.loadRows();
    this.providerApi.connections().pipe(takeUntil(this.destroy$)).subscribe({
      next: (connections) => this.stravaConnection.set(connections.find((item) => item.provider === 'strava') ?? null),
      error: () => this.stravaConnection.set(null),
    });
  }

  ngOnDestroy(): void {
    this.summaryRequestCancelled$.next();
    this.breakdownRequestCancelled$.next();
    this.recalculationRequestCancelled$.next();
    this.manualSaveRequestCancelled$.next();
    this.destroy$.next();
    this.destroy$.complete();
    this.quickEntryRefreshSubscription?.unsubscribe();
    if (this.quickEntryPollTimer) clearTimeout(this.quickEntryPollTimer);
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

  showSummary(): void {
    this.viewMode.set('summary');
  }

  showQuickEntry(): void {
    this.viewMode.set('quick-entry');
    this.loadQuickEntryRows();
  }

  addQuickEntryDate(date: string): void {
    if (!date) return;
    this.viewMode.set('quick-entry');
    if (this.quickEntryState() === 'idle') this.loadQuickEntryRows();
    if (this.quickEntryRows().some((row) => row.date === date)) return;
    this.quickEntryRows.update((rows) => [blankQuickEntryRow(date), ...rows].sort((a, b) => b.date.localeCompare(a.date)));
    this.quickEntryState.set('loaded');
  }

  loadQuickEntryRows(): void {
    this.quickEntryState.set('loading');
    this.quickEntryError.set(null);
    this.scoreBreakdownApi.manualFacts({ from: this.from() || undefined, to: this.to() || undefined, limit: 10_000 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (rows) => {
          this.quickEntryRows.set(rows.map((row) => ({ date: row.date, scoreStatus: row.scoreStatus, totalPoints: row.totalPoints, ...row.facts })));
          this.quickEntryState.set('loaded');
        },
        error: (error: unknown) => {
          this.quickEntryError.set(this.describeSummaryError(error));
          this.quickEntryState.set('error');
        },
      });
  }

  saveQuickEntry(change: DailyQuickEntryChange): void {
    this.patchQuickEntryRow(change.date, { saving: true, error: null });
    this.scoreBreakdownApi.saveManualFacts(change.date, change.input).pipe(takeUntil(this.destroy$)).subscribe({
      next: (result) => {
        this.replaceQuickEntryRow(quickEntryRowFromBreakdown(result));
        this.loadSummaryRows();
      },
      error: (error: unknown) => {
        this.replaceQuickEntryRow({ ...change.previous, saving: false, error: this.describeManualSaveError(error) });
      },
    });
  }

  refreshQuickEntryFromStrava(date: string): void {
    const activeDate = this.quickEntryRows().find((row) => row.refreshing)?.date;
    if (activeDate && activeDate !== date) {
      this.patchQuickEntryRow(date, { error: `Wait for the Strava refresh for ${activeDate} to finish.` });
      return;
    }
    const connection = this.stravaConnection();
    const range = stravaCalendarDateWindow(date);
    if (!connection || connection.status !== 'connected' || !range) {
      this.patchQuickEntryRow(date, { error: 'Connect Strava on the Providers page before refreshing this day.' });
      return;
    }
    this.quickEntryRefreshSubscription?.unsubscribe();
    if (this.quickEntryPollTimer) clearTimeout(this.quickEntryPollTimer);
    this.quickEntryPollCount = 0;
    this.patchQuickEntryRow(date, { refreshing: true, error: null });
    this.quickEntryRefreshSubscription = this.providerApi.enqueueSync(connection.id, 'webhook_refresh', range).subscribe({
      next: (job) => this.pollQuickEntryRefresh(date, job),
      error: (error: unknown) => this.failQuickEntryRefresh(date, error, 'The Strava refresh could not be queued.'),
    });
  }

  private pollQuickEntryRefresh(date: string, job: ProviderSyncJob): void {
    if (job.status === 'succeeded') {
      this.quickEntryRefreshSubscription = this.scoreBreakdownApi.recalculate(date).subscribe({
        next: (result) => {
          this.replaceQuickEntryRow(quickEntryRowFromBreakdown(result));
          this.loadSummaryRows();
        },
        error: (error: unknown) => this.failQuickEntryRefresh(date, error, 'Strava refreshed, but recalculation failed.'),
      });
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      this.failQuickEntryRefresh(date, job.error?.message || `The Strava refresh was ${job.status}.`, 'The Strava refresh failed.');
      return;
    }
    if (++this.quickEntryPollCount > 400) {
      this.failQuickEntryRefresh(date, 'Automatic status refresh paused after ten minutes.', 'Automatic status refresh paused.');
      return;
    }
    this.quickEntryPollTimer = setTimeout(() => {
      this.quickEntryRefreshSubscription = this.providerApi.syncJob(job.id).subscribe({
        next: (nextJob) => this.pollQuickEntryRefresh(date, nextJob),
        error: (error: unknown) => this.failQuickEntryRefresh(date, error, 'The Strava refresh status could not be loaded.'),
      });
    }, 1500);
  }

  private failQuickEntryRefresh(date: string, error: unknown, fallback: string): void {
    const message = typeof error === 'string'
      ? error
      : error instanceof HttpErrorResponse
        ? this.describeRecalculationError(error)
        : fallback;
    this.patchQuickEntryRow(date, { refreshing: false, error: message });
  }

  private patchQuickEntryRow(date: string, patch: Partial<DailyQuickEntryGridRow>): void {
    this.quickEntryRows.update((rows) => rows.map((row) => row.date === date ? { ...row, ...patch } : row));
  }

  private replaceQuickEntryRow(next: DailyQuickEntryGridRow): void {
    this.quickEntryRows.update((rows) => rows.map((row) => row.date === next.date ? next : row));
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

function blankQuickEntryRow(date: string): DailyQuickEntryGridRow {
  return {
    date,
    scoreStatus: 'manual',
    totalPoints: 0,
    steps: 0,
    runIndoorM: 0,
    runOutdoorM: 0,
    runUnspecifiedM: 0,
    bikeIndoorM: 0,
    bikeOutdoorM: 0,
    bikeUnspecifiedM: 0,
    swimM: 0,
    workoutPoints: 0,
    bonusPoints: 0,
  };
}

function quickEntryRowFromBreakdown(result: DailyScoreBreakdown): DailyQuickEntryGridRow {
  const runIndoorM = result.facts.runIndoorM ?? 0;
  const runOutdoorM = result.facts.runOutdoorM ?? 0;
  const bikeIndoorM = result.facts.bikeIndoorM ?? 0;
  const bikeOutdoorM = result.facts.bikeOutdoorM ?? 0;
  return {
    date: result.date,
    scoreStatus: result.scoreStatus,
    totalPoints: result.score.appTotal,
    steps: result.facts.steps,
    runIndoorM,
    runOutdoorM,
    runUnspecifiedM: result.facts.runUnspecifiedM ?? Math.max(result.facts.runM - runIndoorM - runOutdoorM, 0),
    bikeIndoorM,
    bikeOutdoorM,
    bikeUnspecifiedM: result.facts.bikeUnspecifiedM ?? Math.max(result.facts.bikeM - bikeIndoorM - bikeOutdoorM, 0),
    swimM: result.facts.swimM,
    workoutPoints: result.facts.workoutPoints,
    bonusPoints: result.score.bonusPoints,
    saving: false,
    refreshing: false,
    error: null,
  };
}
