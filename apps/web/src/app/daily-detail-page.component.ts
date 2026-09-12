import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import { ScoreBreakdownPanelComponent } from './score-breakdown-panel.component';
import type {
  ApiErrorBody,
  DailyScoreBreakdown,
  ManualDailyFactsInput,
  ScoreBreakdownViewState,
} from './score-breakdown.models';

@Component({
  selector: 'sportos-daily-detail-page',
  standalone: true,
  imports: [RouterLink, ScoreBreakdownPanelComponent],
  template: `
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a routerLink="/daily">Daily Log</a><span aria-hidden="true">›</span><span>{{ date() || 'Daily score' }}</span>
    </nav>
    <sportos-score-breakdown-panel
      [state]="state()"
      [date]="date()"
      [breakdown]="breakdown()"
      [errorMessage]="errorMessage()"
      [recalculating]="recalculating()"
      [recalculationError]="recalculationError()"
      [savingManual]="savingManual()"
      [manualSaveError]="manualSaveError()"
      [manualEditRequestId]="manualEditRequestId()"
      (retry)="load()"
      (recalculate)="recalculate()"
      (saveManualFacts)="saveManualFacts($event)"
      (closed)="close()" />
  `,
  styles: [`
    .breadcrumb { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; color: #667085; font-size: 12px; }
    .breadcrumb a { color: #1d4ed8; font-weight: 700; text-decoration: none; }
  `],
})
export class DailyDetailPageComponent implements OnInit, OnDestroy {
  readonly date = signal<string | null>(null);
  readonly state = signal<ScoreBreakdownViewState>('loading');
  readonly breakdown = signal<DailyScoreBreakdown | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly recalculating = signal(false);
  readonly recalculationError = signal<string | null>(null);
  readonly savingManual = signal(false);
  readonly manualSaveError = signal<string | null>(null);
  readonly manualEditRequestId = signal(0);

  private routeSubscription?: Subscription;
  private requestSubscription?: Subscription;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: ScoreBreakdownApiService,
  ) {}

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const date = params.get('date');
      this.date.set(date);
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.requestSubscription?.unsubscribe();
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
        if (this.isMissing(error) && this.route.snapshot.queryParamMap.get('edit') === 'true') {
          this.breakdown.set(null);
          this.state.set('loaded');
          this.manualEditRequestId.update((value) => value + 1);
          return;
        }
        this.errorMessage.set(this.describe(error, 'The score breakdown could not be loaded.'));
        this.state.set('error');
      },
    });
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
