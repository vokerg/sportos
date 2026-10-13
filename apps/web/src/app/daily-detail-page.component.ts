import { GarminDayCardComponent } from './features/daily/ui/garmin-day-card.component';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ProviderApiService, type ProviderConnection, type ProviderSyncJob } from './provider-api.service';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import { ScoreBreakdownPanelComponent } from './score-breakdown-panel.component';
import type {
  ApiErrorBody,
  DailyEvidence,
  DailyScoreBreakdown,
  ManualDailyFactsInput,
  ScoreBreakdownViewState,
} from './score-breakdown.models';
import { stravaCalendarDateWindow } from './strava-day-refresh';

@Component({
  selector: 'sportos-daily-detail-page',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, ScoreBreakdownPanelComponent, GarminDayCardComponent],
  template: `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a routerLink="/daily">Daily Log</a><span aria-hidden="true">›</span><span>{{ date() || 'Daily score' }}</span>
    </nav>
    <section class="main-actions" aria-label="Day actions">
      <h2>Day actions</h2>
      <div class="action-buttons">
        <button type="button" (click)="recalculate()" [disabled]="state() !== 'loaded' || recalculating() || savingManual() || refreshingFromStrava()">
          {{ recalculating() ? 'Recalculating…' : 'Recalculate from activities' }}
        </button>
        <button type="button" (click)="refreshFromStrava()" [disabled]="!canRefreshFromStrava()" [title]="stravaRefreshHelp()">{{ stravaRefreshButtonLabel() }}</button>
        <ng-container [ngTemplateOutlet]="garmin.primaryAction() ?? null" />
        <button type="button" (click)="requestManualEdit()" [disabled]="state() !== 'loaded' || recalculating() || savingManual() || refreshingFromStrava()">Enter facts manually</button>
      </div>
      <p class="action-help">Strava refresh fetches activities and recalculates this day. Garmin fetch saves evidence; use Recalculate to update the score.</p>
      @if (refreshingFromStrava() || stravaRefreshStatus() || !canRefreshFromStrava()) { <p class="action-help" role="status">{{ stravaRefreshHelp() }}</p> }
      @if (garmin.store.fetching()) { <p class="action-help" role="status">Fetching from Garmin…</p> }
      @if (recalculationError()) { <p class="refresh-error" role="alert">{{ recalculationError() }}</p> }
      @if (stravaRefreshError()) { <p class="refresh-error" role="alert">{{ stravaRefreshError() }}</p> }
      @if (garmin.store.error()) { <p class="refresh-error" role="alert">{{ garmin.store.error() }}</p> }
    </section>
    <sportos-score-breakdown-panel #panel
      [showSummaryActions]="false"
      [garminActivityIds]="garminActivityIds()"
      [state]="state()"
      [date]="date()"
      [breakdown]="breakdown()"
      [evidence]="evidence()"
      [errorMessage]="errorMessage()"
      [recalculating]="recalculating()"
      [recalculationError]="recalculationError()"
      [savingManual]="savingManual()"
      [manualSaveError]="manualSaveError()"
      [manualEditRequestId]="manualEditRequestId()"
      (retry)="load()"
      (recalculate)="recalculate()"
      (saveManualFacts)="saveManualFacts($event)"
      (closed)="close()">
      <sportos-garmin-day-card #garmin [date]="date() ?? ''" [showPrimaryAction]="false" [inspection]="panel.activeTab() === 'sources'" (linkedActivities)="garminActivityIds.set($event)" />
    </sportos-score-breakdown-panel>
  `,
  styles: [`
    .main-actions { margin-bottom: 12px; padding: 16px; border: 1px solid #dbe4f5; border-radius: 12px; background: #f8faff; }
    .main-actions h2 { margin: 0 0 12px; color: #172b4d; font-size: 16px; }
    .action-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
    .action-help { margin: 10px 0 0; color: #667085; font-size: 12px; }
    .breadcrumb { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; color: #667085; font-size: 12px; }
    .breadcrumb a { color: #1d4ed8; font-weight: 700; text-decoration: none; }
    .refresh-error { margin: 8px 0 0; color: #b54747; font-size: 12px; }
  `],
})
export class DailyDetailPageComponent implements OnInit, OnDestroy {
  readonly garminActivityIds = signal<string[]>([]);
  readonly date = signal<string | null>(null);
  readonly state = signal<ScoreBreakdownViewState>('loading');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly evidence = signal<DailyEvidence | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly recalculating = signal(false);
  readonly recalculationError = signal<string | null>(null);
  readonly savingManual = signal(false);
  readonly manualSaveError = signal<string | null>(null);
  readonly manualEditRequestId = signal(0);
  readonly stravaConnection = signal<ProviderConnection | null>(null);
  readonly providerConnectionLoaded = signal(false);
  readonly refreshingFromStrava = signal(false);
  readonly stravaRefreshStatus = signal<string | null>(null);
  readonly stravaRefreshError = signal<string | null>(null);
  readonly activeStravaJobId = signal<string | null>(null);

  private routeSubscription?: Subscription;
  private requestSubscription?: Subscription;
  private evidenceSubscription?: Subscription;
  private providerSubscription?: Subscription;
  private stravaRefreshSubscription?: Subscription;
  private stravaPollTimer?: ReturnType<typeof setTimeout>;
  private stravaPollCount = 0;
  private readonly maxStravaPolls = 400;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: ScoreBreakdownApiService,
    private readonly providerApi: ProviderApiService,
  ) {}

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const date = params.get('date');
      this.clearStravaRefresh();
      this.date.set(date);
      this.load();
      this.loadStravaConnection();
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.requestSubscription?.unsubscribe();
    this.evidenceSubscription?.unsubscribe();
    this.providerSubscription?.unsubscribe();
    this.clearStravaRefresh();
  }

  canRefreshFromStrava(): boolean {
    return this.stravaConnection()?.status === 'connected'
      && !this.refreshingFromStrava()
      && !this.recalculating()
      && !this.savingManual();
  }

  stravaRefreshHelp(): string {
    if (this.stravaRefreshStatus()) return this.stravaRefreshStatus()!;
    if (!this.providerConnectionLoaded()) return 'Checking the connected provider…';
    if (this.stravaConnection()?.status !== 'connected') return 'Connect Strava on the Providers page to enable a targeted refresh.';
    return 'Fetches new or corrected activities from Strava, then recalculates this date.';
  }

  stravaRefreshButtonLabel(): string {
    if (this.refreshingFromStrava()) return 'Refreshing from Strava…';
    return this.activeStravaJobId() ? 'Check refresh status' : 'Refetch day from Strava';
  }

  refreshFromStrava(): void {
    const date = this.date();
    const connection = this.stravaConnection();
    const range = date ? stravaCalendarDateWindow(date) : null;
    if (!date || !connection || connection.status !== 'connected' || !range) return;

    const activeJobId = this.activeStravaJobId();
    if (activeJobId) {
      this.clearStravaPollTimer();
      this.stravaPollCount = 0;
      this.refreshingFromStrava.set(true);
      this.stravaRefreshStatus.set('Checking the Strava refresh status…');
      this.stravaRefreshError.set(null);
      this.fetchStravaJob(activeJobId);
      return;
    }

    this.clearStravaRefresh();
    this.refreshingFromStrava.set(true);
    this.stravaRefreshStatus.set('Queueing a targeted Strava refresh…');
    this.stravaRefreshError.set(null);
    this.stravaRefreshSubscription = this.providerApi.enqueueSync(connection.id, 'webhook_refresh', range).subscribe({
      next: (job) => {
        this.activeStravaJobId.set(job.id);
        this.scheduleStravaPoll(job);
      },
      error: (error: unknown) => this.failStravaRefresh(error, 'The Strava refresh could not be queued.'),
    });
  }

  load(): void {
    const date = this.date();
    if (!date) {
      this.state.set('error');
      this.errorMessage.set('The daily route does not include a date.');
      return;
    }
    this.requestSubscription?.unsubscribe();
    this.state.set('loading');
    this.breakdown.set(null);
    this.evidence.set(null);
    this.errorMessage.set(null);
    this.recalculationError.set(null);
    this.manualSaveError.set(null);
    this.requestSubscription = this.api.getForDate(date).subscribe({
      next: (result) => {
        this.breakdown.set(result);
        this.state.set('loaded');
        if (this.route.snapshot.queryParamMap.get('edit') === 'true') {
          this.manualEditRequestId.update((value) => value + 1);
        }
      },
      error: (error: unknown) => {
        if (this.isMissing(error)) {
          this.breakdown.set(null);
          this.state.set('loaded');
          this.loadEvidence(date);
          if (this.route.snapshot.queryParamMap.get('edit') === 'true') {
            this.manualEditRequestId.update((value) => value + 1);
          }
          return;
        }
        this.errorMessage.set(this.describe(error, 'The score breakdown could not be loaded.'));
        this.state.set('error');
      },
    });
  }

  private loadEvidence(date: string): void {
    this.evidenceSubscription?.unsubscribe();
    this.evidenceSubscription = this.api.getEvidence(date).subscribe({
      next: (result) => this.evidence.set(result),
      error: () => this.evidence.set(null),
    });
  }

  requestManualEdit(): void {
    this.manualEditRequestId.update((value) => value + 1);
  }

  recalculate(): void {
    const date = this.date();
    if (!date) return;
    this.requestSubscription?.unsubscribe();
    this.recalculating.set(true);
    this.recalculationError.set(null);
    this.requestSubscription = this.api.recalculate(date).subscribe({
      next: (result) => {
        this.breakdown.set(result);
        this.state.set('loaded');
        this.recalculating.set(false);
      },
      error: (error: unknown) => {
        this.recalculating.set(false);
        this.recalculationError.set(this.describe(error, 'The recalculation request failed.'));
      },
    });
  }

  saveManualFacts(input: ManualDailyFactsInput): void {
    const date = this.date();
    if (!date) return;
    this.requestSubscription?.unsubscribe();
    this.savingManual.set(true);
    this.manualSaveError.set(null);
    this.requestSubscription = this.api.saveManualFacts(date, input).subscribe({
      next: (result) => {
        this.breakdown.set(result);
        this.state.set('loaded');
        this.savingManual.set(false);
        void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      },
      error: (error: unknown) => {
        this.savingManual.set(false);
        this.manualSaveError.set(this.describe(error, 'The manual facts could not be saved.'));
      },
    });
  }

  close(): void {
    void this.router.navigate(['/daily']);
  }

  private loadStravaConnection(): void {
    this.providerConnectionLoaded.set(false);
    this.stravaConnection.set(null);
    this.providerSubscription?.unsubscribe();
    this.providerSubscription = this.providerApi.connections().subscribe({
      next: (connections) => {
        this.stravaConnection.set(connections.find((item) => item.provider === 'strava') ?? null);
        this.providerConnectionLoaded.set(true);
      },
      error: () => this.providerConnectionLoaded.set(true),
    });
  }

  private scheduleStravaPoll(job: ProviderSyncJob): void {
    this.clearStravaPollTimer();
    if (job.status === 'succeeded') {
      this.activeStravaJobId.set(null);
      this.stravaRefreshStatus.set('Strava is up to date. Recalculating this day…');
      this.recalculateAfterStravaRefresh();
      return;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      this.activeStravaJobId.set(null);
      this.refreshingFromStrava.set(false);
      this.stravaRefreshStatus.set(null);
      this.stravaRefreshError.set(job.error?.message || `The Strava refresh was ${job.status}.`);
      return;
    }
    if (this.stravaPollCount >= this.maxStravaPolls) {
      this.refreshingFromStrava.set(false);
      this.stravaRefreshStatus.set(null);
      this.stravaRefreshError.set('Automatic status refresh paused after ten minutes. Click Check refresh status to continue.');
      return;
    }
    this.stravaPollCount += 1;
    this.stravaRefreshStatus.set(`Strava refresh ${job.status} · ${job.progressPercent}%`);
    this.stravaPollTimer = setTimeout(() => this.fetchStravaJob(job.id), 1500);
  }

  private fetchStravaJob(jobId: string): void {
    this.stravaRefreshSubscription?.unsubscribe();
    this.stravaRefreshSubscription = this.providerApi.syncJob(jobId).subscribe({
      next: (job) => this.scheduleStravaPoll(job),
      error: (error: unknown) => this.failStravaRefresh(error, 'The Strava refresh status could not be loaded.'),
    });
  }

  private recalculateAfterStravaRefresh(): void {
    const date = this.date();
    if (!date) return;
    this.requestSubscription?.unsubscribe();
    this.requestSubscription = this.api.recalculate(date).subscribe({
      next: (result) => {
        this.breakdown.set(result);
        this.state.set('loaded');
        this.refreshingFromStrava.set(false);
        this.stravaRefreshStatus.set('Strava was refetched and this score now uses the latest activities.');
      },
      error: (error: unknown) => this.failStravaRefresh(error, 'Strava was refreshed, but this day could not be recalculated.'),
    });
  }

  private failStravaRefresh(error: unknown, fallback: string): void {
    this.clearStravaPollTimer();
    this.refreshingFromStrava.set(false);
    this.stravaRefreshStatus.set(null);
    this.stravaRefreshError.set(this.describe(error, fallback));
  }

  private clearStravaRefresh(): void {
    this.stravaRefreshSubscription?.unsubscribe();
    this.stravaRefreshSubscription = undefined;
    this.clearStravaPollTimer();
    this.stravaPollCount = 0;
    this.activeStravaJobId.set(null);
    this.refreshingFromStrava.set(false);
    this.stravaRefreshStatus.set(null);
    this.stravaRefreshError.set(null);
  }

  private clearStravaPollTimer(): void {
    if (this.stravaPollTimer) clearTimeout(this.stravaPollTimer);
    this.stravaPollTimer = undefined;
  }

  private isMissing(error: unknown): boolean {
    if (!(error instanceof HttpErrorResponse)) return false;
    const body = this.apiErrorBody(error.error);
    return error.status === 404 || body?.code === 'DAILY_SCORE_NOT_FOUND';
  }

  private describe(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) return fallback;
    const body = this.apiErrorBody(error.error);
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `${fallback} HTTP ${error.status}.`;
  }

  private apiErrorBody(value: unknown): ApiErrorBody | null {
    return value && typeof value === 'object' ? value as ApiErrorBody : null;
  }
}
