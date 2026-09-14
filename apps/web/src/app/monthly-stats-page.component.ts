import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Subject, takeUntil } from 'rxjs';
import {
  ApiService,
  DYNAMICS_METRICS,
  type DynamicsGranularity,
  type DynamicsMeasure,
  type DynamicsMetric,
  type DynamicsResponse,
} from './api.service';
import { DYNAMICS_LABELS, dynamicsChartOptions, formatDynamicsValue, type DynamicsMode } from './monthly-stats.view-model';

type DynamicsState = 'loading' | 'loaded' | 'empty' | 'error';

@Component({
  selector: 'sportos-monthly-stats-page',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <section class="dynamics-heading" aria-labelledby="monthly-stats-title">
      <div><span class="page-kicker">Monthly Stats</span><h1 id="monthly-stats-title">Training by month</h1><p>Monthly totals, recorded-day averages, and selectable bucket trends from canonical SportOS facts.</p></div>
    </section>

    <section class="card controls" aria-label="Monthly statistics controls">
      <div class="filter-bar">
        <label>From <input type="date" [value]="from()" (input)="from.set(inputValue($event))"></label>
        <label>To <input type="date" [value]="to()" (input)="to.set(inputValue($event))"></label>
        <label>Chart grain
          <select [value]="granularity()" (change)="setGranularity(inputValue($event))">
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </label>
        <label>Measure
          <select [value]="measure()" (change)="setMeasure(inputValue($event))">
            <option value="total">Bucket total</option><option value="recordedDayAverage">Recorded-day average</option>
          </select>
        </label>
        <label>Scale
          <select [value]="mode()" (change)="setMode(inputValue($event))">
            <option value="absolute">Absolute</option><option value="indexed">Indexed comparison</option>
          </select>
        </label>
        <button type="button" (click)="apply()" [disabled]="state() === 'loading'">Apply</button>
      </div>

      <fieldset>
        <legend>Metrics (choose up to four)</legend>
        <div class="metric-picker">
          @for (metric of availableMetrics; track metric) {
            <label><input type="checkbox" [checked]="selectedMetrics().includes(metric)" (change)="toggleMetric(metric, checked($event))"> {{ labels[metric] }}</label>
          }
        </div>
      </fieldset>
      @if (selectionMessage()) { <p class="selection-message" role="alert">{{ selectionMessage() }}</p> }
      <p class="semantics">Missing dates remain missing. Averages use recorded days only; coverage shows recorded versus calendar days. Indexed mode sets each metric's first non-zero value to 100.</p>
    </section>

    @if (state() === 'loading') {
      <section class="card state-card" role="status">Loading monthly statistics…</section>
    } @else if (state() === 'error') {
      <section class="card state-card error" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="load()">Retry</button></section>
    } @else if (state() === 'empty') {
      <section class="card state-card"><h2>No recorded days</h2><p>No canonical daily facts exist in this range.</p></section>
    } @else {
      @if (data(); as current) {
        <section class="card chart-card" aria-labelledby="trend-title">
        <div class="section-title"><div><span class="page-kicker">Trend</span><h2 id="trend-title">Selected metrics</h2></div><span>{{ current.range.from }} → {{ current.range.to }}</span></div>
        @if (mode() === 'absolute' && hasMixedUnits()) { <p class="axis-note">Absolute series use a separate labelled axis for each metric. Choose indexed comparison to compare shapes across unlike units.</p> }
        <div echarts class="dynamics-chart" [options]="chartOptions()" role="img" aria-label="Selected SportOS metric trends"></div>
        </section>

        <section class="card table-card" aria-labelledby="monthly-title">
        <div class="section-title"><div><span class="page-kicker">Monthly ledger</span><h2 id="monthly-title">Month-by-month dynamics</h2></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Month</th><th>Coverage</th>@for (metric of current.metrics; track metric) { <th>{{ labels[metric] }} total</th><th>{{ labels[metric] }} avg/day</th> }</tr></thead>
            <tbody>
              @for (bucket of current.monthly; track bucket.key) {
                <tr>
                  <th scope="row">{{ bucket.key }} @if (bucket.partial) { <span class="partial">Partial</span> }</th>
                  <td>{{ bucket.recordedDays }} / {{ bucket.calendarDays }}</td>
                  @for (metric of current.metrics; track metric) {
                    <td>{{ value(bucket, metric, 'total') }}</td><td>{{ value(bucket, metric, 'recordedDayAverage') }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        </section>
      }
    }
  `,
  styles: [`
    .dynamics-heading { margin: 6px 0 22px; }.dynamics-heading h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }.dynamics-heading p, .semantics, .axis-note, .section-title > span { margin: 0; color: #667085; }
    .page-kicker { color: #5368ae; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .controls { display: grid; gap: 12px; margin-bottom: 16px; }.controls .filter-bar { margin: 0; } fieldset { margin: 0; padding: 12px; border: 1px solid #dbe3f0; border-radius: 12px; } legend { padding: 0 6px; color: #475467; font-size: 12px; font-weight: 750; }
    .metric-picker { display: flex; flex-wrap: wrap; gap: 8px 18px; }.metric-picker label { display: flex; align-items: center; gap: 6px; }.metric-picker input { min-width: auto; }.semantics, .axis-note, .selection-message { font-size: 12px; }.selection-message { margin: 0; color: #991b1b; }
    .chart-card, .table-card { margin-bottom: 16px; }.section-title { display: flex; justify-content: space-between; align-items: end; gap: 16px; }.section-title h2 { margin: 4px 0 0; }.dynamics-chart { width: 100%; height: min(52vh, 620px); min-height: 400px; }.axis-note { margin-top: 8px; }
    .table-scroll { margin-top: 14px; overflow-x: auto; border: 1px solid #e4e7ec; border-radius: 12px; } table { width: 100%; border-collapse: collapse; white-space: nowrap; } th, td { padding: 10px 12px; border-bottom: 1px solid #edf0f5; text-align: right; } th:first-child, td:first-child { text-align: left; } thead th { position: sticky; top: 0; background: #f7f9fc; color: #667085; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; } tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }.partial { margin-left: 5px; padding: 3px 6px; border-radius: 999px; background: #fff1d6; color: #945c00; font-size: 9px; text-transform: uppercase; }.state-card { display: grid; gap: 12px; justify-items: start; }.state-card.error { color: #991b1b; }
    @media (max-width: 700px) { .section-title { display: grid; }.dynamics-chart { min-height: 340px; } }
  `],
})
export class MonthlyStatsPageComponent implements OnInit, OnDestroy {
  readonly availableMetrics = DYNAMICS_METRICS;
  readonly labels = DYNAMICS_LABELS;
  readonly from = signal(defaultFrom());
  readonly to = signal(today());
  readonly granularity = signal<DynamicsGranularity>('monthly');
  readonly measure = signal<DynamicsMeasure>('total');
  readonly mode = signal<DynamicsMode>('absolute');
  readonly selectedMetrics = signal<DynamicsMetric[]>(['score', 'steps', 'run']);
  readonly state = signal<DynamicsState>('loading');
  readonly errorMessage = signal<string | null>(null);
  readonly selectionMessage = signal<string | null>(null);
  readonly data = signal<DynamicsResponse | null>(null);
  readonly chartOptions = computed(() => dynamicsChartOptions(this.data(), this.measure(), this.mode()));
  readonly hasMixedUnits = computed(() => {
    const data = this.data();
    return data ? new Set(data.metrics.map((metric) => data.metricUnits[metric])).size > 1 : false;
  });

  private readonly destroy$ = new Subject<void>();
  private readonly requestCancelled$ = new Subject<void>();

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute, private readonly router: Router) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.from.set(validDate(params.get('from')) ?? defaultFrom());
      this.to.set(validDate(params.get('to')) ?? today());
      this.granularity.set(validGranularity(params.get('granularity')) ?? 'monthly');
      this.measure.set(params.get('measure') === 'recordedDayAverage' ? 'recordedDayAverage' : 'total');
      this.mode.set(params.get('mode') === 'indexed' ? 'indexed' : 'absolute');
      const metrics = validMetrics(params.get('metrics'));
      this.selectedMetrics.set(metrics.length ? metrics : ['score', 'steps', 'run']);
      this.load();
    });
  }

  ngOnDestroy(): void { this.requestCancelled$.next(); this.destroy$.next(); this.destroy$.complete(); }

  apply(): void {
    if (this.from() > this.to()) { this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return; }
    void this.router.navigate([], { relativeTo: this.route, queryParams: {
      from: this.from(), to: this.to(), granularity: this.granularity(), metrics: this.selectedMetrics().join(','), measure: this.measure(), mode: this.mode(),
    } });
  }

  load(): void {
    if (this.from() > this.to()) { this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return; }
    this.requestCancelled$.next(); this.state.set('loading'); this.errorMessage.set(null);
    this.api.monthlyStats({ from: this.from(), to: this.to(), granularity: this.granularity(), metrics: this.selectedMetrics() })
      .pipe(takeUntil(this.requestCancelled$), takeUntil(this.destroy$))
      .subscribe({
        next: (response) => { this.data.set(response); this.state.set(response.monthly.some((bucket) => bucket.recordedDays > 0) ? 'loaded' : 'empty'); },
        error: (error: unknown) => { this.data.set(null); this.state.set('error'); this.errorMessage.set(describeError(error)); },
      });
  }

  toggleMetric(metric: DynamicsMetric, selected: boolean): void {
    const current = this.selectedMetrics();
    if (selected && current.length >= 4) { this.selectionMessage.set('Choose at most four metrics.'); return; }
    if (!selected && current.length === 1) { this.selectionMessage.set('Keep at least one metric selected.'); return; }
    this.selectionMessage.set(null);
    this.selectedMetrics.set(selected ? [...current, metric] : current.filter((value) => value !== metric));
  }

  setGranularity(value: string): void { const valid = validGranularity(value); if (valid) this.granularity.set(valid); }
  setMeasure(value: string): void { if (value === 'total' || value === 'recordedDayAverage') this.measure.set(value); }
  setMode(value: string): void { if (value === 'absolute' || value === 'indexed') this.mode.set(value); }
  inputValue(event: Event): string { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  value(bucket: DynamicsResponse['monthly'][number], metric: DynamicsMetric, measure: DynamicsMeasure): string { return formatDynamicsValue(bucket, metric, measure, this.data()!.metricUnits[metric]); }
}

function validDate(value: string | null): string | null { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }
function validGranularity(value: string | null): DynamicsGranularity | null { return value === 'daily' || value === 'weekly' || value === 'monthly' ? value : null; }
function validMetrics(value: string | null): DynamicsMetric[] { const values = value?.split(',') ?? []; return values.length <= 4 && new Set(values).size === values.length && values.every((metric) => DYNAMICS_METRICS.includes(metric as DynamicsMetric)) ? values as DynamicsMetric[] : []; }
function today(): string { return new Date().toISOString().slice(0, 10); }
function defaultFrom(): string { const date = new Date(`${today()}T00:00:00.000Z`); date.setUTCFullYear(date.getUTCFullYear() - 1); return date.toISOString().slice(0, 10); }
function describeError(error: unknown): string { if (!(error instanceof HttpErrorResponse)) return 'Monthly stats could not be loaded.'; if (error.status === 0) return 'The SportOS API is unavailable.'; const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {}; return typeof body.message === 'string' ? body.message : `Monthly stats could not be loaded (HTTP ${error.status}).`; }
