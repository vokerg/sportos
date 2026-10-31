import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Subject, takeUntil } from 'rxjs';
import {
  boundedAllTimeRange, isDateRangeOrdered, QUICK_RANGE_VALUES, quickRangeDates,
  readAnalyticsDateRange, readQueryEnum, type QuickRange,
} from '../../../shared/util/analytics-query-state';
import { PaceSpeedApiService } from '../data-access/pace-speed-api.service';
import {
  DEFAULT_THRESHOLDS, bucketDateRange, fillTrendBuckets, formatKm, formatTrendValue,
  thresholdOptions, trendChartOptions, type PaceSpeedBucket, type PaceSpeedGranularity,
  type PaceSpeedResponse, type PaceSpeedSport,
} from '../model/pace-speed.models';

type LoadState = 'loading' | 'loaded' | 'empty' | 'error';
const DEFAULT_RANGE = '6m' as const;

@Component({
  selector: 'sportos-average-pace-page',
  standalone: true,
  imports: [RouterLink, NgxEchartsDirective],
  template: `
    <section class="report-page" aria-labelledby="report-title">
      <a class="back-link" routerLink="/stats">← Stats</a>
      <header>
        <span class="page-kicker">Training reports</span>
        <h1 id="report-title">{{ sport() === 'bike' ? 'Average Speed' : 'Average Pace' }}</h1>
        <p>Distance-weighted {{ sport() === 'bike' ? 'cycling speed' : sport() === 'swim' ? 'swimming pace' : 'running pace' }} alongside training volume.</p>
      </header>

      <section class="card controls" aria-label="Average pace and speed controls">
        <div class="filter-bar">
          <label>Sport
            <select [value]="sport()" (change)="setSport(inputValue($event))">
              <option value="run">Running</option><option value="bike">Cycling</option><option value="swim">Swimming</option>
            </select>
          </label>
          <label>Quick range
            <select [value]="quickRange()" (change)="setQuickRange(inputValue($event))">
              <option value="custom">Custom range</option>
              <option value="1m">1 month</option><option value="3m">3 months</option>
              <option value="6m">6 months</option><option value="ytd">YTD</option>
              <option value="1y">1 year</option><option value="3y">3 years</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label>From <input type="date" [value]="from()" (input)="setFrom(inputValue($event))"></label>
          <label>To <input type="date" [value]="to()" (input)="setTo(inputValue($event))"></label>
          <label>Chart grain
            <select [value]="granularity()" (change)="setGranularity(inputValue($event))">
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </label>
          <button type="button" (click)="apply()" [disabled]="state() === 'loading'">Apply</button>
        </div>
        <fieldset class="pace-filter">
          <legend>Pace / speed filter</legend>
          <label class="exclude-check">
            <input type="checkbox" [checked]="filterEnabled()" (change)="setFilterEnabled(checked($event))">
            {{ sport() === 'bike' ? 'Exclude rides below' : sport() === 'swim' ? 'Exclude swims slower than' : 'Exclude runs slower than' }}
          </label>
          <select [attr.aria-label]="'Threshold for ' + sport()" [value]="threshold()" (change)="setThreshold(inputValue($event))" [disabled]="!filterEnabled()">
            @for (option of thresholdOptions(); track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
          <button type="button" class="secondary reset-button" [disabled]="!filterEnabled() || threshold() === defaultThreshold()" (click)="resetThreshold()">Reset</button>
        </fieldset>
        <p class="semantics">Averages use total eligible time ÷ eligible distance (speed uses distance ÷ time). Slower activities can be omitted from the average, but their distance remains visible in total volume. Activities without usable time are shown as not used.</p>
      </section>

      @if (state() === 'loading') {
        <section class="card state-card" role="status">Loading pace and volume trends…</section>
      } @else if (state() === 'error') {
        <section class="card state-card" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="load()">Retry</button></section>
      } @else if (state() === 'empty') {
        <section class="card state-card"><h2>No {{ sport() === 'bike' ? 'rides' : sport() === 'swim' ? 'swims' : 'runs' }} in this range</h2><p>Try a longer period or another sport.</p></section>
      } @else {
        <section class="card chart-card" aria-labelledby="pace-trend-title">
          <div class="section-title">
            <div><span class="page-kicker">Trend</span><h2 id="pace-trend-title">{{ sport() === 'bike' ? 'Speed and volume' : 'Pace and volume' }}</h2></div>
            <span>{{ from() }} → {{ to() }}</span>
          </div>
          <div echarts class="pace-chart" [theme]="colorScheme.chartTheme()" [options]="chartOptions()" role="img" [attr.aria-label]="sport() + ' weighted trend and volume'"></div>
          <p class="chart-note">Blue = distance contributing to the average; gray = filtered out or missing time. Blank pace points mean no usable activities.</p>
        </section>
        <section class="card table-card" aria-labelledby="pace-table-title">
          <div class="section-title"><div><span class="page-kicker">Breakdown</span><h2 id="pace-table-title">{{ granularity() === 'weekly' ? 'Weekly' : granularity() === 'monthly' ? 'Monthly' : 'Daily' }} activity ledger</h2></div></div>
          <div class="table-scroll">
            <table>
              <thead><tr><th>Period</th><th>{{ sport() === 'bike' ? 'Speed' : 'Pace' }}</th><th>Total km</th><th>Included km</th><th>Not used km</th><th>Activities used</th><th></th></tr></thead>
              <tbody>
                @for (bucket of rows(); track bucket.key) {
                  <tr>
                    <th scope="row">{{ bucketLabel(bucket.key) }}</th>
                    <td>{{ formatValue(bucket.value) }}</td>
                    <td>{{ formatKm(bucket.totalDistanceM) }}</td>
                    <td>{{ formatKm(bucket.includedDistanceM) }}</td>
                    <td>{{ formatKm(notUsed(bucket)) }}</td>
                    <td>{{ bucket.includedActivities }} / {{ bucket.activities }}</td>
                    <td><a routerLink="/activities" [queryParams]="activityQuery(bucket.key)" [attr.aria-label]="'View activities for ' + bucketLabel(bucket.key)">Activities →</a></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .report-page { max-width: 1100px; margin: 0 auto; }
    .back-link { display: inline-block; margin-bottom: 18px; color: var(--link); font-size: 13px; font-weight: 700; }
    header { margin: 6px 0 24px; }
    .page-kicker { color: var(--link); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }
    header p, .semantics, .chart-note, .section-title > span { margin: 0; color: var(--text-muted); line-height: 1.5; }
    .controls { display: grid; gap: 14px; margin-bottom: 16px; }
    .filter-bar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
    label { display: grid; gap: 5px; color: var(--text-secondary); font-size: 12px; font-weight: 700; }
    label select { min-width: 128px; }
    .pace-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px; margin: 0; border: 1px solid var(--border-accent); border-radius: 10px; }
    .pace-filter legend { padding: 0 6px; font-size: 12px; color: var(--text-secondary); font-weight: 750; }
    .exclude-check { display: flex; align-items: center; gap: 8px; }
    .exclude-check input { min-width: auto; }
    .reset-button { min-height: 36px; }
    .semantics, .chart-note { font-size: 12px; }
    .chart-card, .table-card { margin-bottom: 16px; }
    .section-title { display: flex; justify-content: space-between; align-items: end; gap: 14px; }
    .section-title h2 { margin: 4px 0 0; }
    .pace-chart { width: 100%; height: min(64vh, 620px); min-height: 410px; margin-top: 10px; }
    .table-scroll { max-height: 610px; overflow: auto; margin-top: 14px; }
    table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
    th, td { padding: 11px 12px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
    th:first-child { text-align: left; }
    thead th { position: sticky; top: 0; background: var(--accent-surface); color: var(--text-muted); font-size: 10px; text-transform: uppercase; z-index: 1; }
    tbody th { color: var(--text-secondary); }
    td a { color: var(--link); font-size: 12px; font-weight: 700; }
    .state-card { display: grid; justify-items: start; gap: 12px; }
    .state-card[role="alert"] { color: var(--danger); }
    @media (max-width: 700px) { .section-title { display: grid; }.pace-chart { min-height: 360px; } }
  `],
})
export class AveragePacePageComponent implements OnInit, OnDestroy {
  readonly colorScheme = inject(ColorSchemeService);
  readonly sport = signal<PaceSpeedSport>('run');
  readonly from = signal(quickRangeDates(DEFAULT_RANGE).from);
  readonly to = signal(quickRangeDates(DEFAULT_RANGE).to);
  readonly quickRange = signal<QuickRange>(DEFAULT_RANGE);
  readonly granularity = signal<PaceSpeedGranularity>('weekly');
  readonly filterEnabled = signal(true);
  readonly threshold = signal(DEFAULT_THRESHOLDS.run);
  readonly state = signal<LoadState>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly data = signal<PaceSpeedResponse | null>(null);
  readonly rows = computed(() => this.data() ? fillTrendBuckets(this.data()!) : []);
  readonly chartOptions = computed(() => trendChartOptions(this.rows(), this.sport()));
  readonly defaultThreshold = computed(() => DEFAULT_THRESHOLDS[this.sport()]);
  readonly thresholdOptions = computed(() => thresholdOptions(this.sport()));
  readonly formatKm = formatKm;

  private readonly destroyed$ = new Subject<void>();
  private readonly cancelled$ = new Subject<void>();

  constructor(private readonly api: PaceSpeedApiService, private readonly route: ActivatedRoute, private readonly router: Router) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroyed$)).subscribe(params => {
      const range = readAnalyticsDateRange(params, quickRangeDates(DEFAULT_RANGE));
      this.from.set(range.from); this.to.set(range.to); this.quickRange.set(range.quickRange);
      const sport = readQueryEnum(params.get('sport'), ['run', 'bike', 'swim'] as const, 'run');
      this.sport.set(sport);
      this.granularity.set(readQueryEnum(params.get('granularity'), ['daily', 'weekly', 'monthly'] as const, 'weekly'));
      const saved = this.readPreferences(sport);
      const requestedThreshold = Number(params.get('threshold'));
      this.threshold.set(params.has('threshold') && this.thresholdOptions().some(option => option.value === requestedThreshold)
        ? requestedThreshold : saved.threshold);
      this.filterEnabled.set(params.get('filter') === '1' ? true : params.get('filter') === '0' ? false : saved.enabled);
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.cancelled$.next();
    this.destroyed$.next();
    this.destroyed$.complete();
    this.cancelled$.complete();
  }

  load(): void {
    if (!isDateRangeOrdered(this.from(), this.to())) {
      this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return;
    }
    this.cancelled$.next();
    this.state.set('loading');
    this.errorMessage.set(null);
    this.data.set(null);
    this.api.trends({
      from: this.from(), to: this.to(), sport: this.sport(), granularity: this.granularity(),
      threshold: this.filterEnabled() ? this.threshold() : null,
    }).pipe(takeUntil(this.cancelled$), takeUntil(this.destroyed$)).subscribe({
      next: response => {
        this.data.set(response);
        this.state.set(response.buckets.some(bucket => bucket.activities > 0) ? 'loaded' : 'empty');
      },
      error: () => { this.state.set('error'); this.errorMessage.set('Could not load pace and speed statistics.'); },
    });
  }

  apply(): void {
    if (!isDateRangeOrdered(this.from(), this.to())) {
      this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return;
    }
    this.savePreferences();
    void this.router.navigate([], { relativeTo: this.route, queryParams: {
      from: this.from(), to: this.to(), sport: this.sport(),
      granularity: this.granularity(), filter: this.filterEnabled() ? '1' : '0', threshold: this.threshold(),
    } });
  }

  setSport(value: string): void {
    if (value !== 'run' && value !== 'bike' && value !== 'swim') return;
    this.savePreferences();
    this.sport.set(value);
    const saved = this.readPreferences(value);
    this.threshold.set(saved.threshold);
    this.filterEnabled.set(saved.enabled);
    this.apply();
  }
  setQuickRange(value: string): void {
    if (!QUICK_RANGE_VALUES.includes(value as QuickRange)) return;
    this.quickRange.set(value as QuickRange);
    if (value === 'custom') return;
    const dates = value === 'all' ? boundedAllTimeRange() : quickRangeDates(value as Exclude<QuickRange, 'custom'>);
    this.from.set(dates.from); this.to.set(dates.to);
    this.apply();
  }
  setFrom(value: string): void { this.from.set(value); this.quickRange.set('custom'); }
  setTo(value: string): void { this.to.set(value); this.quickRange.set('custom'); }
  setGranularity(value: string): void {
    if (value === 'daily' || value === 'weekly' || value === 'monthly') this.granularity.set(value);
  }
  setFilterEnabled(value: boolean): void { this.filterEnabled.set(value); this.apply(); }
  setThreshold(value: string): void {
    const parsed = Number(value);
    if (!this.thresholdOptions().some(option => option.value === parsed)) return;
    this.threshold.set(parsed); this.apply();
  }
  resetThreshold(): void { this.threshold.set(this.defaultThreshold()); this.apply(); }
  inputValue(event: Event): string { return (event.target as HTMLSelectElement | HTMLInputElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  formatValue(value: number | null): string { return formatTrendValue(value, this.sport()); }
  notUsed(bucket: PaceSpeedBucket): number { return Math.max(0, bucket.totalDistanceM - bucket.includedDistanceM); }
  bucketLabel(key: string): string { return this.granularity() === 'monthly' ? key.slice(0, 7) : key; }
  activityQuery(key: string): Record<string, string> {
    const dates = bucketDateRange(key, this.granularity(), this.from(), this.to());
    return { ...dates, activityType: this.sport(), source: 'all' };
  }

  private readPreferences(sport: PaceSpeedSport): { enabled: boolean; threshold: number } {
    const fallback = { enabled: sport === 'run', threshold: DEFAULT_THRESHOLDS[sport] };
    try {
      if (typeof localStorage === 'undefined') return fallback;
      const saved = JSON.parse(localStorage.getItem('sportos:pace-speed:' + sport) ?? 'null') as { enabled?: unknown; threshold?: unknown } | null;
      if (!saved) return fallback;
      return {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : fallback.enabled,
        threshold: thresholdOptions(sport).some(option => option.value === saved.threshold) ? saved.threshold as number : fallback.threshold,
      };
    } catch { return fallback; }
  }
  private savePreferences(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('sportos:pace-speed:' + this.sport(),
          JSON.stringify({ enabled: this.filterEnabled(), threshold: this.threshold() }));
      }
    } catch { /* Private browsing may disable storage; the URL still preserves filters. */ }
  }
}
