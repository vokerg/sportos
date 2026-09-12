import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, type DailySummaryRow } from './api.service';
import { DailyQuickSheetComponent } from './daily-quick-sheet.component';
import { formatDate } from './date-time';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { ApiErrorBody, DailyScoreBreakdown, ScoreBreakdownViewState } from './score-breakdown.models';

type OverviewState = 'loading' | 'loaded' | 'empty' | 'error';

@Component({
  selector: 'sportos-overview-page',
  standalone: true,
  imports: [RouterLink, DailyQuickSheetComponent],
  template: `
    <section class="overview-heading" aria-labelledby="overview-title">
      <div><span class="page-kicker">Overview</span><h1 id="overview-title">Your training, at a glance</h1><p>A concise starting point. The complete ledger remains in Daily Log.</p></div>
      <div class="overview-actions"><a routerLink="/daily">Open Daily Log</a><a class="secondary-link" routerLink="/imports">Review imports</a></div>
    </section>

    @if (state() === 'loading') {
      <section class="card state-card" role="status">Loading recent official scores…</section>
    } @else if (state() === 'error') {
      <section class="card state-card error" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="load()">Try again</button></section>
    } @else if (state() === 'empty') {
      <section class="card state-card"><h2>No scored days yet</h2><p>Import a workbook, sync a provider, or enter daily facts to get started.</p><a routerLink="/imports">Go to imports</a></section>
    } @else {
      <section class="summary-grid" aria-label="Recent score summary">
        <article class="card hero-score"><span>Latest score</span><strong>{{ number(latest()?.total_points) }}</strong><small>{{ formatDate(latest()?.metric_date) }} · {{ status(latest()?.score_status) }}</small></article>
        <article class="card metric"><span>30-day average</span><strong>{{ number(latest()?.avg_30d) }}</strong><small>Official rolling average</small></article>
        <article class="card metric"><span>Latest base</span><strong>{{ number(latest()?.base_points) }}</strong><small>Before bonuses</small></article>
        <article class="card metric"><span>Latest bonus</span><strong>{{ signed(latest()?.bonus_points) }}</strong><small>Rule contributions</small></article>
      </section>

      <section class="card recent-card" aria-labelledby="recent-days-title">
        <div class="section-heading"><div><span class="page-kicker">Recent days</span><h2 id="recent-days-title">Select a day for highlights</h2></div><a routerLink="/daily">All rows and columns →</a></div>
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
    .page-kicker { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }
    h2 { margin: 5px 0 0; font-size: 20px; }
    p { margin: 0; color: #667085; }
    .overview-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .overview-actions a, .state-card a { padding: 10px 14px; border-radius: 11px; background: #1d4ed8; color: #fff; font-weight: 700; text-decoration: none; white-space: nowrap; }
    .overview-actions .secondary-link { background: #e4e7ec; color: #344054; }
    .summary-grid { display: grid; grid-template-columns: 1.35fr repeat(3, 1fr); gap: 14px; }
    .summary-grid article { display: grid; gap: 5px; min-height: 130px; align-content: center; }
    .summary-grid span { color: #667085; font-size: 12px; font-weight: 700; }
    .summary-grid strong { color: #243b73; font-size: 29px; letter-spacing: -.02em; }
    .hero-score { background: linear-gradient(135deg, #234fc8, #183788); }
    .hero-score span, .hero-score small { color: #dce6ff; }.hero-score strong { color: #fff; font-size: 42px; }
    .summary-grid small { color: #667085; font-size: 11px; }
    .recent-card { margin-top: 16px; overflow: hidden; }
    .section-heading { align-items: end; margin-bottom: 14px; }
    .section-heading a { color: #1d4ed8; font-size: 12px; font-weight: 750; text-decoration: none; }
    .recent-table { overflow-x: auto; border: 1px solid #e4e7ec; border-radius: 12px; }
    .table-row { display: grid; grid-template-columns: minmax(130px, 1.2fr) minmax(100px, 1fr) repeat(4, minmax(88px, .8fr)); align-items: center; min-width: 710px; width: 100%; min-height: 48px; padding: 0 14px; border: 0; border-bottom: 1px solid #edf0f5; border-radius: 0; background: #fff; color: #172033; text-align: left; }
    button.table-row:hover { background: #f5f7fc; }.table-row:last-child { border-bottom: 0; }
    .table-row.header { min-height: 38px; background: #f7f9fc; color: #667085; font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
    .status { padding: 4px 7px; border-radius: 999px; background: #e7edff; color: #40558f; font-weight: 800; text-transform: capitalize; }
    .status[data-status='imported'] { background: #e6f6eb; color: #13795b; }.status[data-status='manual'] { background: #fff1d6; color: #945c00; }
    .state-card { display: grid; gap: 14px; justify-items: start; }.state-card.error { color: #b54747; }
    @media (max-width: 940px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 680px) { .overview-heading { display: grid; }.summary-grid { grid-template-columns: 1fr; } }
  `],
})
export class OverviewPageComponent implements OnInit, OnDestroy {
  readonly rows = signal<DailySummaryRow[]>([]);
  readonly state = signal<OverviewState>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly latest = computed(() => this.rows()[0]);
  readonly recent = computed(() => this.rows().slice(0, 10));
  readonly selectedDate = signal<string | null>(null);
  readonly breakdownState = signal<ScoreBreakdownViewState>('idle');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly breakdownError = signal<string | null>(null);
  readonly formatDate = formatDate;

  private rowsSubscription?: Subscription;
  private breakdownSubscription?: Subscription;

  constructor(
    private readonly api: ApiService,
    private readonly scoreApi: ScoreBreakdownApiService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.rowsSubscription?.unsubscribe(); this.breakdownSubscription?.unsubscribe(); }

  load(): void {
    this.rowsSubscription?.unsubscribe();
    this.state.set('loading');
    this.errorMessage.set(null);
    this.rowsSubscription = this.api.dailySummary({ limit: 31 }).subscribe({
      next: (rows) => { this.rows.set(rows); this.state.set(rows.length ? 'loaded' : 'empty'); },
      error: (error: unknown) => { this.rows.set([]); this.state.set('error'); this.errorMessage.set(this.describe(error)); },
    });
  }

  selectDay(row: DailySummaryRow): void { this.selectedDate.set(row.metric_date); this.loadBreakdown(row.metric_date); }
  retryBreakdown(): void { const date = this.selectedDate(); if (date) this.loadBreakdown(date); }
  closeSheet(): void { this.breakdownSubscription?.unsubscribe(); this.selectedDate.set(null); this.breakdown.set(null); this.breakdownError.set(null); this.breakdownState.set('idle'); }
  openDay(edit = false): void { const date = this.selectedDate(); if (date) void this.router.navigate(['/daily', date], { queryParams: edit ? { edit: 'true' } : undefined }); }

  number(value: number | null | undefined): string { return value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value); }
  signed(value: number | null | undefined): string { return value === null || value === undefined ? '—' : `${value >= 0 ? '+' : ''}${this.number(value)}`; }
  distance(value: number): string { return `${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} km`; }
  status(value: DailySummaryRow['score_status'] | undefined): string { return value === 'manual' ? 'Manual edit' : value === 'imported' ? 'Imported' : 'Calculated'; }

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
