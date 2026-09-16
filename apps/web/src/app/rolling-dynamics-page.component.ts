import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Subject, takeUntil } from 'rxjs';
import {
  ApiService,
  DYNAMICS_METRICS,
  ROLLING_WINDOWS,
  type DynamicsMeasure,
  type DynamicsMetric,
  type RollingDynamicsResponse,
  type RollingWindow,
} from './api.service';
import { DYNAMICS_LABELS } from './monthly-stats.view-model';
import { QUICK_RANGE_VALUES, quickRangeDates, type QuickRange } from './daily-log.view-model';
import { formatRollingValue, rollingDynamicsChartOptions, rollingMeasure } from './rolling-dynamics.view-model';

type PageState = 'loading' | 'loaded' | 'empty' | 'error';
const DEFAULT_ROLLING_QUICK_RANGE: Exclude<QuickRange, 'custom' | 'all'> = '1y';

@Component({
  selector: 'sportos-rolling-dynamics-page',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <section class="page-heading" aria-labelledby="dynamics-title">
      <div><span class="page-kicker">Dynamics</span><h1 id="dynamics-title">Rolling daily change</h1><p>See how trailing windows move every calendar day as new activity enters and old activity expires.</p></div>
    </section>

    <section class="card controls" aria-label="Rolling dynamics controls">
      <div class="filter-bar">
        <label>Quick range
          <select [value]="quickRange()" (change)="setQuickRange(inputValue($event))">
            <option value="custom">Custom range</option>
            <option value="1m">1 month</option>
            <option value="3m">3 months</option>
            <option value="6m">6 months</option>
            <option value="ytd">YTD</option>
            <option value="1y">1 year</option>
            <option value="3y">3 years</option>
          </select>
        </label>
        <label>From <input type="date" [value]="from()" (input)="setFrom(inputValue($event))"></label>
        <label>To <input type="date" [value]="to()" (input)="setTo(inputValue($event))"></label>
        <label>Metric
          <select [value]="metric()" (change)="setMetric(inputValue($event))">
            @for (option of metrics; track option) { <option [value]="option">{{ labels[option] }}</option> }
          </select>
        </label>
        <label>Value
          <select [value]="measure()" (change)="setMeasure(inputValue($event))">
            <option value="recordedDayAverage">Average per calendar day</option><option value="total">Rolling total</option>
          </select>
        </label>
        <button type="button" (click)="apply()" [disabled]="state() === 'loading'">Apply</button>
        <button type="button" class="secondary" (click)="resetRange()" [disabled]="state() === 'loading'">Reset</button>
      </div>
      <fieldset><legend>Trailing windows</legend><div class="window-picker">
        @for (window of availableWindows; track window) {
          <label><input type="checkbox" [checked]="windows().includes(window)" (change)="toggleWindow(window, checked($event))"> {{ window }} days</label>
        }
      </div></fieldset>
      @if (selectionMessage()) { <p class="selection-message" role="alert">{{ selectionMessage() }}</p> }
      <p class="semantics">Each point uses that date and the preceding N−1 calendar days. Values expire on the exact day they leave the window. Coverage reports persisted daily rows; incomplete coverage can understate a calendar-day average.</p>
    </section>

    @if (state() === 'loading') {
      <section class="card state-card" role="status">Loading rolling dynamics…</section>
    } @else if (state() === 'error') {
      <section class="card state-card error" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="load()">Retry</button></section>
    } @else if (state() === 'empty') {
      <section class="card state-card"><h2>No canonical values</h2><p>This range and its selected lookback contain no recorded values for {{ labels[metric()] }}.</p></section>
    } @else {
      @if (data(); as current) {
        <section class="latest-grid" aria-label="Latest rolling values">
        @for (window of current.windows; track window) {
          <article class="card latest"><span>{{ window }} day {{ measure() === 'total' ? 'total' : 'average' }}</span><strong>{{ latestValue(window) }}</strong><small>{{ latestCoverage(window) }}</small></article>
        }
        </section>

        <section class="card chart-card" aria-labelledby="rolling-chart-title">
        <div class="section-title"><div><span class="page-kicker">Daily timeline</span><h2 id="rolling-chart-title">{{ labels[current.metric] }}</h2></div><span>{{ current.range.from }} → {{ current.range.to }}</span></div>
        <div echarts class="rolling-chart" [options]="chartOptions()" role="img" [attr.aria-label]="labels[current.metric] + ' rolling daily dynamics'"></div>
        </section>

        <section class="card table-card" aria-labelledby="rolling-table-title">
        <div class="section-title"><div><span class="page-kicker">Daily ledger</span><h2 id="rolling-table-title">Exact rolling values</h2></div></div>
        <div class="table-scroll"><table>
          <thead><tr><th>Date</th><th>Daily value</th>@for (window of current.windows; track window) { <th>{{ window }}d {{ measure() === 'total' ? 'total' : 'avg/day' }}</th><th>{{ window }}d coverage</th> }</tr></thead>
          <tbody>@for (point of reversedPoints(); track point.date) {
            <tr><th scope="row">{{ point.date }}</th><td>{{ format(point.dailyValue) }}</td>@for (window of current.windows; track window) { <td>{{ format(point.windows[window]?.[measureKey()]) }}</td><td [class.incomplete]="!point.windows[window]?.complete">{{ point.windows[window]?.recordedDays }} / {{ point.windows[window]?.windowDays }}</td> }</tr>
          }</tbody>
        </table></div>
        </section>
      }
    }
  `,
  styles: [`
    .page-heading { margin: 6px 0 22px; }.page-heading h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }.page-heading p, .semantics, .section-title > span { margin: 0; color: #667085; }.page-kicker { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .controls { display: grid; gap: 12px; margin-bottom: 16px; }.controls .filter-bar { margin: 0; } fieldset { margin: 0; padding: 12px; border: 1px solid #dbe3f0; border-radius: 12px; } legend { padding: 0 6px; color: #475467; font-size: 12px; font-weight: 750; }.window-picker { display: flex; flex-wrap: wrap; gap: 8px 18px; }.window-picker label { display: flex; align-items: center; gap: 6px; }.window-picker input { min-width: auto; }.semantics, .selection-message { font-size: 12px; }.selection-message { margin: 0; color: #991b1b; }
    .latest-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }.latest { display: grid; gap: 5px; }.latest span, .latest small { color: #667085; font-size: 12px; }.latest strong { color: #243b73; font-size: 27px; }.chart-card, .table-card { margin-bottom: 16px; }.section-title { display: flex; justify-content: space-between; align-items: end; gap: 16px; }.section-title h2 { margin: 4px 0 0; }.rolling-chart { width: 100%; height: min(52vh, 620px); min-height: 400px; }
    .table-scroll { margin-top: 14px; max-height: 640px; overflow: auto; border: 1px solid #e4e7ec; border-radius: 12px; } table { width: 100%; border-collapse: collapse; white-space: nowrap; } th, td { padding: 10px 12px; border-bottom: 1px solid #edf0f5; text-align: right; } th:first-child { text-align: left; } thead th { position: sticky; top: 0; z-index: 1; background: #f7f9fc; color: #667085; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }.incomplete { color: #a15c00; background: #fffaf0; }.state-card { display: grid; gap: 12px; justify-items: start; }.state-card.error { color: #991b1b; }
    @media (max-width: 700px) { .section-title { display: grid; }.rolling-chart { min-height: 340px; } }
  `],
})
export class RollingDynamicsPageComponent implements OnInit, OnDestroy {
  readonly metrics = DYNAMICS_METRICS;
  readonly labels = DYNAMICS_LABELS;
  readonly availableWindows = ROLLING_WINDOWS;
  readonly quickRange = signal<QuickRange>(DEFAULT_ROLLING_QUICK_RANGE);
  readonly from = signal(defaultRange().from);
  readonly to = signal(defaultRange().to);
  readonly metric = signal<DynamicsMetric>('run');
  readonly windows = signal<RollingWindow[]>([30, 365]);
  readonly measure = signal<DynamicsMeasure>('recordedDayAverage');
  readonly state = signal<PageState>('loading');
  readonly data = signal<RollingDynamicsResponse | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly selectionMessage = signal<string | null>(null);
  readonly chartOptions = computed(() => rollingDynamicsChartOptions(this.data(), this.measure()));
  readonly reversedPoints = computed(() => [...(this.data()?.points ?? [])].reverse());
  readonly measureKey = computed(() => rollingMeasure(this.measure()));
  private readonly destroy$ = new Subject<void>();
  private readonly requestCancelled$ = new Subject<void>();

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute, private readonly router: Router) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const fallback = defaultRange();
      const from = validDate(params.get('from')) ?? fallback.from;
      const to = validDate(params.get('to')) ?? fallback.to;
      this.from.set(from);
      this.to.set(to);
      this.quickRange.set(matchingQuickRange(from, to));
      this.metric.set(validMetric(params.get('metric')) ?? 'run');
      this.windows.set(validWindows(params.get('windows')));
      this.measure.set(params.get('measure') === 'total' ? 'total' : 'recordedDayAverage');
      this.load();
    });
  }

  ngOnDestroy(): void { this.requestCancelled$.next(); this.destroy$.next(); this.destroy$.complete(); }

  apply(): void {
    if (this.from() > this.to()) { this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return; }
    void this.router.navigate([], { relativeTo: this.route, queryParams: { from: this.from(), to: this.to(), metric: this.metric(), windows: this.windows().join(','), measure: this.measure() } });
  }

  load(): void {
    if (this.from() > this.to()) { this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return; }
    this.requestCancelled$.next(); this.state.set('loading'); this.errorMessage.set(null);
    this.api.rollingDynamics({ from: this.from(), to: this.to(), metric: this.metric(), windows: this.windows() })
      .pipe(takeUntil(this.requestCancelled$), takeUntil(this.destroy$))
      .subscribe({
        next: (response) => { this.data.set(response); this.state.set(hasValues(response) ? 'loaded' : 'empty'); },
        error: (error: unknown) => { this.data.set(null); this.state.set('error'); this.errorMessage.set(describeError(error)); },
      });
  }

  toggleWindow(window: RollingWindow, selected: boolean): void {
    const current = this.windows();
    if (!selected && current.length === 1) { this.selectionMessage.set('Keep at least one trailing window selected.'); return; }
    this.selectionMessage.set(null);
    this.windows.set((selected ? [...current, window] : current.filter((value) => value !== window)).sort((a, b) => a - b));
  }

  setQuickRange(value: string): void {
    if (!QUICK_RANGE_VALUES.includes(value as QuickRange) || value === 'all') return;
    const range = value as Exclude<QuickRange, 'all'>;
    this.quickRange.set(range);
    if (range === 'custom') return;
    const dates = quickRangeDates(range);
    this.from.set(dates.from);
    this.to.set(dates.to);
    this.apply();
  }

  setFrom(value: string): void { this.from.set(value); this.quickRange.set('custom'); }
  setTo(value: string): void { this.to.set(value); this.quickRange.set('custom'); }
  resetRange(): void {
    const dates = defaultRange();
    this.quickRange.set(DEFAULT_ROLLING_QUICK_RANGE);
    this.from.set(dates.from);
    this.to.set(dates.to);
    this.apply();
  }

  setMetric(value: string): void { const metric = validMetric(value); if (metric) this.metric.set(metric); }
  setMeasure(value: string): void { if (value === 'total' || value === 'recordedDayAverage') this.measure.set(value); }
  inputValue(event: Event): string { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  format(value: number | null | undefined): string { return formatRollingValue(value, this.data()!.unit); }
  latestValue(window: RollingWindow): string { const value = this.data()?.points.at(-1)?.windows[window]?.[this.measureKey()]; return this.format(value); }
  latestCoverage(window: RollingWindow): string { const value = this.data()?.points.at(-1)?.windows[window]; return value ? `${value.recordedDays} / ${value.windowDays} days recorded${value.complete ? '' : ' · incomplete'}` : 'No coverage'; }
}

function validDate(value: string | null): string | null { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }
function validMetric(value: string | null): DynamicsMetric | null { return value && DYNAMICS_METRICS.includes(value as DynamicsMetric) ? value as DynamicsMetric : null; }
function validWindows(value: string | null): RollingWindow[] { const values = value?.split(',').map(Number) ?? [30, 365]; return values.length && new Set(values).size === values.length && values.every((window) => ROLLING_WINDOWS.includes(window as RollingWindow)) ? values as RollingWindow[] : [30, 365]; }
function hasValues(response: RollingDynamicsResponse): boolean { return response.points.some((point) => response.windows.some((window) => point.windows[window]?.total !== null)); }
function defaultRange(): { from: string; to: string } { return quickRangeDates(DEFAULT_ROLLING_QUICK_RANGE); }
function matchingQuickRange(from: string, to: string): QuickRange {
  for (const range of ['1m', '3m', '6m', 'ytd', '1y', '3y'] as const) {
    const dates = quickRangeDates(range, new Date(`${to}T00:00:00.000Z`));
    if (dates.from === from && dates.to === to) return range;
  }
  return 'custom';
}
function describeError(error: unknown): string { if (!(error instanceof HttpErrorResponse)) return 'Rolling dynamics could not be loaded.'; if (error.status === 0) return 'The SportOS API is unavailable.'; const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {}; return typeof body.message === 'string' ? body.message : `Rolling dynamics could not be loaded (HTTP ${error.status}).`; }
