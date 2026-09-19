import { HttpErrorResponse } from '@angular/common/http';
import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { type DailySummaryRow, ApiService } from '../../../api.service';
import { pollDurableJob } from '../../../core/jobs/durable-job-poller';
import {
  DEFAULT_QUICK_RANGE,
  QUICK_RANGE_VALUES,
  type DailyLogSummaryState,
  type QuickRange,
  quickRangeDates,
} from '../../../daily-log.view-model';
import { ProviderApiService, type ProviderConnection, type ProviderSyncJob } from '../../../provider-api.service';
import { ScoreBreakdownApiService } from '../../../score-breakdown-api.service';
import type {
  ApiErrorBody,
  DailyScoreBreakdown,
  ManualDailyFactsInput,
  ScoreBreakdownViewState,
} from '../../../score-breakdown.models';
import { stravaCalendarDateWindow } from '../../../strava-day-refresh';
import {
  blankQuickEntryRow,
  quickEntryRowFromBreakdown,
  type DailyQuickEntryChange,
  type DailyQuickEntryGridRow,
} from '../model/daily-quick-entry.models';

const QUICK_ENTRY_POLL_INTERVAL_MS = 1_500;
const QUICK_ENTRY_POLL_MAX_ATTEMPTS = 400;
const QUICK_ENTRY_POLL_MAX_DURATION_MS = 10 * 60 * 1_000;

@Injectable()
export class DailyLogStore implements OnDestroy {
  readonly rows = signal<DailySummaryRow[]>([]);
  readonly latestAverage = computed(() => this.rows()[0]?.avg_30d ?? null);
  readonly from = signal(quickRangeDates(DEFAULT_QUICK_RANGE).from);
  readonly to = signal(quickRangeDates(DEFAULT_QUICK_RANGE).to);
  readonly quickRange = signal<QuickRange>(DEFAULT_QUICK_RANGE);
  readonly summaryState = signal<DailyLogSummaryState>('loading');
  readonly summaryError = signal<string | null>(null);

  readonly selectedDate = signal<string | null>(null);
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

  private initialized = false;
  private summarySubscription?: Subscription;
  private breakdownSubscription?: Subscription;
  private recalculationSubscription?: Subscription;
  private manualSaveSubscription?: Subscription;
  private quickEntryLoadSubscription?: Subscription;
  private providerConnectionsSubscription?: Subscription;
  private quickEntryRefreshSubscription?: Subscription;
  private readonly quickEntrySaveSubscriptions = new Map<string, Subscription>();

  constructor(
    private readonly api: ApiService,
    private readonly scoreBreakdownApi: ScoreBreakdownApiService,
    private readonly providerApi: ProviderApiService,
  ) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.loadRows();
    this.providerConnectionsSubscription = this.providerApi.connections().subscribe({
      next: (connections) => this.stravaConnection.set(connections.find((item) => item.provider === 'strava') ?? null),
      error: () => this.stravaConnection.set(null),
    });
  }

  ngOnDestroy(): void {
    this.summarySubscription?.unsubscribe();
    this.breakdownSubscription?.unsubscribe();
    this.recalculationSubscription?.unsubscribe();
    this.manualSaveSubscription?.unsubscribe();
    this.quickEntryLoadSubscription?.unsubscribe();
    this.providerConnectionsSubscription?.unsubscribe();
    this.quickEntryRefreshSubscription?.unsubscribe();
    for (const subscription of this.quickEntrySaveSubscriptions.values()) subscription.unsubscribe();
    this.quickEntrySaveSubscriptions.clear();
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
    this.quickEntryLoadSubscription?.unsubscribe();
    this.quickEntryState.set('loading');
    this.quickEntryError.set(null);
    this.quickEntryLoadSubscription = this.scoreBreakdownApi.manualFacts({
      from: this.from() || undefined,
      to: this.to() || undefined,
      limit: 10_000,
    }).subscribe({
      next: (rows) => {
        this.quickEntryRows.set(rows.map((row) => ({
          date: row.date,
          scoreStatus: row.scoreStatus,
          totalPoints: row.totalPoints,
          ...row.facts,
        })));
        this.quickEntryState.set('loaded');
      },
      error: (error: unknown) => {
        this.quickEntryError.set(this.describeSummaryError(error));
        this.quickEntryState.set('error');
      },
    });
  }

  saveQuickEntry(change: DailyQuickEntryChange): void {
    this.quickEntrySaveSubscriptions.get(change.date)?.unsubscribe();
    this.patchQuickEntryRow(change.date, { saving: true, error: null });

    const subscription = this.scoreBreakdownApi.saveManualFacts(change.date, change.input).subscribe({
      next: (result) => {
        this.quickEntrySaveSubscriptions.delete(change.date);
        this.replaceQuickEntryRow(quickEntryRowFromBreakdown(result));
        this.loadSummaryRows();
      },
      error: (error: unknown) => {
        this.quickEntrySaveSubscriptions.delete(change.date);
        this.replaceQuickEntryRow({
          ...change.previous,
          saving: false,
          error: this.describeManualSaveError(error),
        });
      },
    });
    this.quickEntrySaveSubscriptions.set(change.date, subscription);
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
    this.patchQuickEntryRow(date, { refreshing: true, error: null });
    this.quickEntryRefreshSubscription = this.providerApi.enqueueSync(connection.id, 'webhook_refresh', range).subscribe({
      next: (job) => {
        if (this.isTerminalProviderJob(job)) {
          this.handleQuickEntryTerminalJob(date, job);
          return;
        }
        this.pollQuickEntryRefresh(date, job.id);
      },
      error: (error: unknown) => this.failQuickEntryRefresh(date, error, 'The Strava refresh could not be queued.'),
    });
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

  saveManualFacts(input: ManualDailyFactsInput): void {
    const date = this.selectedDate();
    if (!date) return;

    this.manualSaveSubscription?.unsubscribe();
    this.manualSaveState.set('working');
    this.manualSaveError.set(null);
    this.manualSaveSubscription = this.scoreBreakdownApi.saveManualFacts(date, input).subscribe({
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
    this.manualSaveSubscription?.unsubscribe();
    this.breakdownSubscription = undefined;
    this.recalculationSubscription = undefined;
    this.manualSaveSubscription = undefined;
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
    this.summarySubscription?.unsubscribe();
    this.summaryState.set('loading');
    this.summaryError.set(null);
    this.summarySubscription = this.api.dailySummary({
      from: this.from() || undefined,
      to: this.to() || undefined,
      limit: 10_000,
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

  private loadBreakdown(date: string, allowMissing = false): void {
    this.breakdownSubscription?.unsubscribe();
    this.recalculationSubscription?.unsubscribe();
    this.manualSaveSubscription?.unsubscribe();
    this.recalculationSubscription = undefined;
    this.manualSaveSubscription = undefined;
    this.recalculationState.set('idle');
    this.manualSaveState.set('idle');
    this.recalculationError.set(null);
    this.manualSaveError.set(null);
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

  private pollQuickEntryRefresh(date: string, jobId: string): void {
    this.quickEntryRefreshSubscription?.unsubscribe();
    this.quickEntryRefreshSubscription = pollDurableJob(
      () => this.providerApi.syncJob(jobId),
      {
        intervalMs: QUICK_ENTRY_POLL_INTERVAL_MS,
        maxAttempts: QUICK_ENTRY_POLL_MAX_ATTEMPTS,
        maxDurationMs: QUICK_ENTRY_POLL_MAX_DURATION_MS,
        isTerminal: (job) => this.isTerminalProviderJob(job),
      },
    ).subscribe({
      next: (state) => {
        if (state.state === 'terminal') {
          this.handleQuickEntryTerminalJob(date, state.job);
          return;
        }
        if (state.state === 'error') {
          this.failQuickEntryRefresh(date, state.error, 'The Strava refresh status could not be loaded.');
          return;
        }
        if (state.state === 'exhausted') {
          this.failQuickEntryRefresh(
            date,
            'Automatic status refresh paused after ten minutes.',
            'Automatic status refresh paused.',
          );
        }
      },
    });
  }

  private handleQuickEntryTerminalJob(date: string, job: ProviderSyncJob): void {
    if (job.status === 'succeeded') {
      this.quickEntryRefreshSubscription?.unsubscribe();
      this.quickEntryRefreshSubscription = this.scoreBreakdownApi.recalculate(date).subscribe({
        next: (result) => {
          this.replaceQuickEntryRow(quickEntryRowFromBreakdown(result));
          this.loadSummaryRows();
        },
        error: (error: unknown) => this.failQuickEntryRefresh(
          date,
          error,
          'Strava refreshed, but recalculation failed.',
        ),
      });
      return;
    }

    this.failQuickEntryRefresh(
      date,
      job.error?.message || `The Strava refresh was ${job.status}.`,
      'The Strava refresh failed.',
    );
  }

  private failQuickEntryRefresh(date: string, error: unknown, fallback: string): void {
    const message = typeof error === 'string'
      ? error
      : error instanceof HttpErrorResponse
        ? this.describeRecalculationError(error)
        : fallback;
    this.patchQuickEntryRow(date, { refreshing: false, error: message });
  }

  private isTerminalProviderJob(job: ProviderSyncJob): boolean {
    return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
  }

  private patchQuickEntryRow(date: string, patch: Partial<DailyQuickEntryGridRow>): void {
    this.quickEntryRows.update((rows) => rows.map((row) => row.date === date ? { ...row, ...patch } : row));
  }

  private replaceQuickEntryRow(next: DailyQuickEntryGridRow): void {
    this.quickEntryRows.update((rows) => rows.map((row) => row.date === next.date ? next : row));
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
    if (body?.code === 'DAILY_SCORE_NOT_FOUND' || error.status === 404) {
      return body?.message || 'No persisted score exists for the selected date.';
    }
    if (body?.code === 'INVALID_DATE' || error.status === 400) return body?.message || 'The selected date is invalid.';
    if (body?.code === 'SCORE_BREAKDOWN_INCONSISTENT') {
      return 'The persisted score failed consistency checks. Review the import and ledger data before using this total.';
    }
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The API returned HTTP ${error.status}.`;
  }

  private describeRecalculationError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The recalculation request failed unexpectedly.';
    const body = this.apiErrorBody(error.error);
    if (body?.code === 'STRAVA_DATA_UNAVAILABLE' || error.status === 409) {
      return body?.message || 'No Strava activity is available for the selected date.';
    }
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
