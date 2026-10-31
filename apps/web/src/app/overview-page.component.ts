import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivitiesApiService, ActivityCardComponent, type ActivitiesResponse as HomeActivities } from './features/activities';
import { boundedAllTimeRange, localCalendarDate } from './shared/util/analytics-query-state';
import { homeAverages } from '../../../../packages/shared/src/home-summary';
import { DailyApiService } from './features/daily/data-access/daily-api.service';
import type { DailySummaryRow } from './features/daily/model/daily.models';
import { DailyQuickSheetComponent } from './daily-quick-sheet.component';
import { formatDate } from './date-time';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { ApiErrorBody, DailyScoreBreakdown, ScoreBreakdownViewState } from './score-breakdown.models';
import { ProviderStore } from './features/providers/state/provider.store';

type OverviewState = 'loading' | 'loaded' | 'empty' | 'error';

@Component({
  selector: 'sportos-overview-page',
  standalone: true,
  imports: [RouterLink, DailyQuickSheetComponent, ActivityCardComponent],
  providers: [ProviderStore],
  template: `
    <section class="overview-heading" aria-labelledby="overview-title">
      <div><span class="page-kicker">Overview</span><h1 id="overview-title">Your training, at a glance</h1><p>Build your rhythm. A little perspective on the work you put in.</p></div>
      <div class="overview-actions">
        <a routerLink="/daily">Open Daily Log</a>
        @if (providerStore.state() === 'loading') {
          <button type="button" class="strava-button" disabled>Checking Strava…</button>
        } @else if (providerStore.state() === 'error') {
          <button type="button" class="secondary-button" (click)="providerStore.load()">Retry Strava</button>
        } @else if (providerStore.connection()?.status === 'connected') {
          <button type="button" class="strava-button" [disabled]="providerStore.busy()" (click)="importStrava()">{{ stravaActionLabel() }}</button>
        } @else {
          <a class="secondary-link" routerLink="/providers">{{ providerStore.connection() ? 'Reconnect Strava' : 'Connect Strava' }}</a>
        }
      </div>
    </section>

    @if (providerStore.job(); as job) {
      <div class="strava-job" aria-live="polite">
        <span>Strava import {{ job.status }} · {{ job.progressPercent }}% · {{ job.phase }}</span>
        @if (job.status === 'queued' || job.status === 'running') {
          <button type="button" class="secondary-button" (click)="providerStore.cancel()">Cancel import</button>
        }
        @if (providerStore.pollingPaused() || providerStore.state() === 'error') {
          <button type="button" class="secondary-button" (click)="providerStore.refreshJob()">Check status</button>
        }
        @if (job.error) { <span class="strava-error" role="alert">{{ job.error.message }}</span> }
      </div>
    }
    @if (providerStore.errorMessage()) { <p class="strava-error" role="alert">{{ providerStore.errorMessage() }}</p> }

    @if (state() === 'loading') {
      <section class="card state-card" role="status">Loading your training snapshot…</section>
    } @else if (state() === 'error') {
      <section class="card state-card error" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="load()">Try again</button></section>
    } @else if (state() === 'empty') {
      <section class="card state-card"><h2>No scored days in the last 30 days</h2><p>Import a workbook, sync a provider, or enter daily facts to get started.</p><a routerLink="/imports">Go to imports</a></section>
    }
    @if (state() === 'loaded' || state() === 'empty') {
      <section class="summary-grid" aria-label="Last 30 days averages">
        <article class="card hero-score"><span>Your 30-day rhythm</span><strong>{{ number(averages().score) }} <em>pt / day</em></strong><small>{{ range.from }} — {{ range.to }}</small><small>{{ averages().count }} of 30 days recorded · averages use recorded days</small></article>
        <article class="card metric"><span>Daily movement</span><strong>{{ number(averages().steps) }} <em>steps</em></strong><small>Average per recorded day</small></article>
        <article class="card metric"><span>Workout average</span><strong>{{ number(averages().workout) }} <em>pt / day</em></strong><small>Bonus average · {{ number(averages().bonus) }} pt / day</small></article>
      </section>
      <section class="card recent-card" aria-label="Seven-day sport totals">
        <div class="section-heading"><div><span class="page-kicker">Last 7 days · {{ week.from }} — {{ week.to }}</span><h2>Your week in motion</h2></div><a routerLink="/activities">Explore activities →</a></div>
        <div class="sport-grid">
          @for (sport of sports; track sport.type) {
            <article class="sport-tile" [attr.data-sport]="sport.type"><span>{{ sport.label }}</span>
              @if (sportData()[sport.type]; as data) { <strong>{{ distance(data.summary.distanceM) }}</strong><small>{{ data.summary.count }} sessions · canonical activities</small> }
              @else { <strong>—</strong><small>{{ activityLoading() ? 'Loading…' : 'Unavailable' }}</small> }
              <small>30-day daily avg · {{ optionalDistance(averages()[sport.type]) }}</small>
            </article>
          }
        </div>
      </section>
      <section class="card recent-card" aria-labelledby="sessions-title">
        <div class="section-heading"><div><span class="page-kicker">Fresh off the finish line</span><h2 id="sessions-title">Recent sessions</h2></div><a routerLink="/activities">View all →</a></div>
        @if (activityLoading()) { <p role="status">Loading activities…</p> }
        @else if (activityError()) { <p role="alert">Some activity data is unavailable.</p><button type="button" (click)="loadActivities()">Retry activities</button> }
        @for (activity of activities()?.items ?? []; track activity.id) {
          <sportos-activity-card [activity]="activity" />
        }
        @if (!activityLoading() && !activityError() && !activities()?.items?.length) { <p>No sessions in the last 30 days.</p> }
      </section>

      <section class="card recent-card" aria-labelledby="recent-days-title">
        <div class="section-heading"><div><span class="page-kicker">Recent days</span><h2 id="recent-days-title">Your last three scored days</h2></div></div>
        <div class="recent-table" role="table" aria-label="Recent scored days">
          <div class="table-row header" role="row"><span role="columnheader">Date</span><span role="columnheader">Authority</span><span role="columnheader">Steps</span><span role="columnheader">Run</span><span role="columnheader">Bike</span><span role="columnheader">Total</span></div>
          @for (row of recent(); track row.metric_date) {
            <button type="button" class="table-row" role="row" (click)="selectDay(row)">
              <span role="cell">{{ formatDate(row.metric_date) }}</span><span role="cell"><small class="status" [attr.data-status]="row.score_status">{{ status(row.score_status) }}</small></span><span role="cell">{{ number(row.steps) }}</span><span role="cell">{{ distance(row.run_m) }}</span><span role="cell">{{ distance(row.bike_m) }}</span><strong role="cell">{{ number(row.total_points) }}</strong>
            </button>
          }
        </div>
      </section>
    }

    <sportos-daily-quick-sheet
      [state]="breakdownState()"
      [date]="selectedDate()"
      [breakdown]="breakdown()"
      [errorMessage]="breakdownError()"
      (closed)="closeSheet()"
      (opened)="openDay()"
      (edit)="openDay(true)"
      (retry)="retryBreakdown()"
      (recalculate)="openDay()" />
  `,
  styles: [`
    .overview-heading, .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
    .overview-heading { margin: 6px 0 22px; }
    .page-kicker { color: var(--link); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }
    h2 { margin: 5px 0 0; font-size: 20px; }
    p { margin: 0; color: var(--text-muted); }
    .overview-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .overview-actions a, .state-card a { padding: 10px 14px; border-radius: 11px; background: var(--primary); color: var(--on-primary); font-weight: 700; text-decoration: none; white-space: nowrap; }
    .overview-actions .secondary-link { background: var(--surface-muted); color: var(--text-secondary); }
    .overview-actions button { min-height: 40px; padding: 10px 14px; border-radius: 11px; font: inherit; font-size: 13px; font-weight: 750; white-space: nowrap; }
    .overview-actions .strava-button { background: var(--provider-strava); color: #fff; }
    .overview-actions .secondary-button, .strava-job .secondary-button { background: var(--surface-muted); color: var(--text-secondary); }
    .strava-job { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: -8px 0 16px; color: var(--text-muted); font-size: 12px; }
    .strava-job button { padding: 6px 10px; border-radius: 9px; font: inherit; font-weight: 700; }
    .strava-error { margin: -8px 0 14px; color: var(--danger); font-size: 12px; }
    .summary-grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 14px; }
    .summary-grid article { display: grid; gap: 5px; min-height: 130px; align-content: center; }
    .summary-grid span { color: var(--text-muted); font-size: 12px; font-weight: 700; }
    .summary-grid strong { color: var(--link); font-size: 29px; letter-spacing: -.02em; }
    .hero-score { background: linear-gradient(135deg, #234fc8, #183788); }
    .hero-score strong { color: var(--on-primary); font-size: 42px; }
    .summary-grid small { color: var(--text-muted); font-size: 11px; }
    .summary-grid .hero-score span, .summary-grid .hero-score small { color: #dce6ff; }
    .recent-card { margin-top: 16px; overflow: hidden; }
    .section-heading { align-items: end; margin-bottom: 14px; }
    .section-heading a { color: var(--link); font-size: 12px; font-weight: 750; text-decoration: none; }
    .recent-table { overflow-x: auto; border: 1px solid var(--border); border-radius: 12px; }
    .table-row { display: grid; grid-template-columns: minmax(130px, 1.2fr) minmax(100px, 1fr) repeat(4, minmax(88px, .8fr)); align-items: center; min-width: 710px; width: 100%; min-height: 48px; padding: 0 14px; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: var(--surface); color: var(--text); text-align: left; }
    button.table-row:hover { background: var(--accent-surface); }.table-row:last-child { border-bottom: 0; }
    .table-row.header { min-height: 38px; background: var(--accent-surface); color: var(--text-muted); font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .status { padding: 4px 7px; border-radius: 999px; background: var(--accent-surface); color: var(--link); font-weight: 800; text-transform: capitalize; }
    .status[data-status='imported'] { background: var(--success-surface); color: var(--success); }.status[data-status='manual'] { background: var(--warning-surface); color: var(--warning); }
    .state-card { display: grid; gap: 14px; justify-items: start; }.state-card.error { color: var(--danger); }
    em { font-size: 12px; font-weight: 500; font-style: normal; }
    .sport-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .sport-tile { display: grid; gap: 9px; padding: 20px; border-radius: 16px; background: var(--accent-surface); border-top: 3px solid #14b8a6; }
    .sport-tile[data-sport=bike] { border-color: #f59e0b; }.sport-tile[data-sport=swim] { border-color: #6095ff; }
    .sport-tile strong { font-size: clamp(23px, 3vw, 34px); letter-spacing: -.04em; }.sport-tile small { color: var(--text-muted); }
    sportos-activity-card { display: block; margin-top: 10px; }
    @media (max-width: 940px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 680px) { .overview-heading { display: grid; }.summary-grid { grid-template-columns: 1fr; }.sport-grid { grid-template-columns: 1fr; }.sport-tile { padding: 16px; }.table-row { grid-template-columns: 1.2fr 1fr 1fr; min-width: 0; padding: 10px; gap: 8px; }.table-row > :nth-child(2), .table-row > :nth-child(4), .table-row > :nth-child(5) { display: none; } }
  `],
})
export class OverviewPageComponent implements OnInit, OnDestroy {
  readonly rows = signal<DailySummaryRow[]>([]);
  readonly state = signal<OverviewState>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly latest = computed(() => this.rows()[0]);
  readonly recent = computed(() => this.rows().slice(0, 3));
  readonly range = boundedAllTimeRange(localCalendarDate(), 30);
  readonly week = boundedAllTimeRange(this.range.to, 7);
  readonly averages = computed(() => homeAverages(this.rows(), this.range.from, this.range.to));
  readonly sports = [{ type: 'run' as const, label: 'Running' }, { type: 'bike' as const, label: 'Cycling' }, { type: 'swim' as const, label: 'Swimming' }];
  readonly activities = signal<HomeActivities | null>(null);
  readonly sportData = signal<Partial<Record<'run' | 'bike' | 'swim', HomeActivities>>>({});
  readonly activityLoading = signal(true);
  readonly activityError = signal(false);
  private activitySubscriptions = new Subscription();
  readonly selectedDate = signal<string | null>(null);
  readonly breakdownState = signal<ScoreBreakdownViewState>('idle');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly breakdownError = signal<string | null>(null);
  readonly formatDate = formatDate;

  private rowsSubscription?: Subscription;
  private breakdownSubscription?: Subscription;

  constructor(
    private readonly api: DailyApiService,
    private readonly scoreApi: ScoreBreakdownApiService,
    private readonly router: Router,
    readonly providerStore: ProviderStore,
    private readonly overviewApi: ActivitiesApiService,
  ) {}

  ngOnInit(): void { this.load(); this.loadActivities(); this.providerStore.initialize(); }
  ngOnDestroy(): void { this.rowsSubscription?.unsubscribe(); this.breakdownSubscription?.unsubscribe(); this.activitySubscriptions.unsubscribe(); }

  load(): void {
    this.rowsSubscription?.unsubscribe();
    this.state.set('loading');
    this.errorMessage.set(null);
    this.rowsSubscription = this.api.dailySummary({ ...this.range, limit: 30 }).subscribe({
      next: (rows) => { this.rows.set(rows); this.state.set(rows.length ? 'loaded' : 'empty'); },
      error: (error: unknown) => { this.rows.set([]); this.state.set('error'); this.errorMessage.set(this.describe(error)); },
    });
  }

  loadActivities(): void {
    this.activitySubscriptions.unsubscribe();
    this.activitySubscriptions = new Subscription();
    this.activityLoading.set(true); this.activityError.set(false); this.activities.set(null); this.sportData.set({});
    let pending = 4;
    const done = () => { if (--pending === 0) this.activityLoading.set(false); };
    this.activitySubscriptions.add(this.overviewApi.list({ ...this.range, limit: 3, offset: 0 }).subscribe({
      next: data => this.activities.set(data), error: () => { this.activityError.set(true); done(); }, complete: done,
    }));
    for (const sport of this.sports) this.activitySubscriptions.add(this.overviewApi.list({ ...this.week, activityType: sport.type, limit: 1, offset: 0 }).subscribe({
      next: data => this.sportData.update(values => ({ ...values, [sport.type]: data })),
      error: () => { this.activityError.set(true); done(); }, complete: done,
    }));
  }
  optionalDistance(value: number | null): string { return value === null || !Number.isFinite(value) ? '—' : this.distance(value); }

  selectDay(row: DailySummaryRow): void { this.selectedDate.set(row.metric_date); this.loadBreakdown(row.metric_date); }
  retryBreakdown(): void { const date = this.selectedDate(); if (date) this.loadBreakdown(date); }
  closeSheet(): void { this.breakdownSubscription?.unsubscribe(); this.selectedDate.set(null); this.breakdown.set(null); this.breakdownError.set(null); this.breakdownState.set('idle'); }
  openDay(edit = false): void { const date = this.selectedDate(); if (date) void this.router.navigate(['/daily', date], { queryParams: edit ? { edit: 'true' } : undefined }); }

  number(value: number | null | undefined): string { return value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value); }
  signed(value: number | null | undefined): string { return value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${this.number(value)}`; }
  distance(value: number): string { return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} km`; }
  status(value: DailySummaryRow['score_status'] | undefined): string { return value === 'manual' ? 'Manual edit' : value === 'imported' ? 'Imported' : 'Calculated'; }

  importStrava(): void {
    const connection = this.providerStore.connection();
    if (!connection || connection.status !== 'connected') return;
    const job = this.providerStore.job();
    if (job?.status === 'failed' && job.attemptCount < job.maxAttempts) {
      this.providerStore.retry();
      return;
    }
    this.providerStore.sync(connection.lastSyncAt ? 'incremental' : 'initial_backfill');
  }

  stravaActionLabel(): string {
    if (this.providerStore.recoveringLatestJob()) return 'Checking Strava status…';
    if (this.providerStore.state() === 'working') return 'Starting Strava import…';
    const job = this.providerStore.job();
    if (job?.status === 'queued' || job?.status === 'running') return `Importing Strava… ${job.progressPercent}%`;
    if (job?.status === 'failed' && job.attemptCount < job.maxAttempts) return 'Retry Strava import';
    return 'Import Strava';
  }

  private loadBreakdown(date: string): void {
    this.breakdownSubscription?.unsubscribe();
    this.breakdown.set(null);
    this.breakdownError.set(null);
    this.breakdownState.set('loading');
    this.breakdownSubscription = this.scoreApi.getForDate(date).subscribe({
      next: (result) => { this.breakdown.set(result); this.breakdownState.set('loaded'); },
      error: (error: unknown) => { this.breakdownError.set(this.describe(error)); this.breakdownState.set('error'); },
    });
  }

  private describe(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The SportOS API request failed.';
    const body = error.error && typeof error.error === 'object' ? error.error as ApiErrorBody : null;
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The SportOS API request failed with HTTP ${error.status}.`;
  }
}
