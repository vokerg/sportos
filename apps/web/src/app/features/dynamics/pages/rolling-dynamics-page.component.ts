import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import { inject, Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { connect, disconnect, type EChartsType } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Subject, takeUntil } from 'rxjs';
import { DynamicsStore } from '../state/dynamics.store';
import { historyMetric, metricUnit, historyHeatRanges, historyTableRows } from '../model/history.view-model';
import {
  DYNAMICS_METRICS,
  ROLLING_WINDOWS,
  type DynamicsMetric,
  type RollingDynamicsMeasure,
  type RollingWindow,
} from '../model/dynamics.models';
import { DYNAMICS_LABELS } from '../model/dynamics.models';
import {
  localCalendarDate,
  isDateRangeOrdered,
  QUICK_RANGE_VALUES,
  quickRangeDates,
  readAnalyticsDateRange,
  readQueryEnum,
  readQueryNumberCsv,
  type QuickRange,
} from '../../../shared/util/analytics-query-state';
import { formatRollingMeasureValue, formatRollingValue, ROLLING_AGGREGATE_METRICS, rollingDynamicsChartOptions, rollingMeasure, scoreContributionChartOptions, type RollingAggregateMetric } from '../model/rolling-dynamics.view-model';

let chartGroupSequence = 0;
const DEFAULT_ROLLING_QUICK_RANGE: Exclude<QuickRange, 'custom' | 'all'> = '1y';

@Component({
  selector: 'sportos-rolling-dynamics-page',
  standalone: true,
  imports: [NgxEchartsDirective],
  providers: [DynamicsStore],
  template: `
    <section class="page-heading" aria-labelledby="dynamics-title">
      <div><span class="page-kicker">Dynamics</span><h1 id="dynamics-title">Rolling daily change</h1><p>See how trailing windows move every calendar day as new activity enters and old activity expires.</p></div>
    </section>

    <section class="card controls" aria-label="Rolling dynamics controls">
      <form class="filter-bar" (submit)="$event.preventDefault(); apply()">
        <label>Quick range
          <select [value]="selectedQuickRange()" (change)="setQuickRange(inputValue($event))">
            <option value="custom">Custom range</option>
            <option value="1m">1 month</option>
            <option value="3m">3 months</option>
            <option value="6m">6 months</option>
            <option value="ytd">YTD</option>
            <option value="1y">1 year</option>
            <option value="3y">3 years</option>
            <option value="all">All time</option>
          </select>
        </label>
        <label>From <input type="date" [value]="from()" (input)="setFrom(inputValue($event))"></label>
        <label>To <input type="date" [value]="to()" (input)="setTo(inputValue($event))"></label>
        <label>Metric
          <select [value]="metric()" (change)="setMetric(inputValue($event))">
            @for (option of metrics; track option) { <option [value]="option" [selected]="metric() === option">{{ labels[option] }}</option> }
          </select>
        </label>
        <label>Value
          <select [value]="measure()" (change)="setMeasure(inputValue($event))">
            <option value="recordedDayAverage">Avg/day</option>
            <option value="total">Total</option>
            <option value="activeDays" [disabled]="metric() === 'score'">Active days</option>
          </select>
        </label>
        <button type="submit" [disabled]="state() === 'loading'">Apply</button>
        <button type="button" class="secondary" (click)="resetRange()" [disabled]="state() === 'loading'">Reset</button>
      </form>
      <fieldset><legend>Trailing windows</legend><div class="window-picker">
        @for (window of availableWindows; track window) {
          <label><input type="checkbox" [checked]="windows().includes(window)" (change)="toggleWindow(window, checked($event))"> {{ window }} days</label>
        }
      </div></fieldset>
      @if (selectionMessage()) { <p class="selection-message" role="alert">{{ selectionMessage() }}</p> }
      <details class="semantics"><summary>How trailing windows work</summary><p>Charts include today, marked Incomplete while Garmin and Strava data may still arrive. Choose an earlier end date for completed days only. Each point uses that date and the preceding N−1 calendar days. Values expire on the exact day they leave the window. Active days counts dates where the selected activity is greater than zero. Coverage reports persisted daily rows; incomplete coverage can understate an avg/day or active-day count.</p></details>
    </section>

    @if (state() === 'loading') {
      <section class="card state-card" role="status">Loading rolling dynamics…</section>
    } @else if (state() === 'error') {
      <section class="card state-card error" role="alert"><p>{{ errorMessage() }}</p><button type="button" (click)="load(true)">Retry</button></section>
    } @else if (state() === 'empty') {
      <section class="card state-card"><h2>No canonical values</h2><p>This range and its selected lookback contain no recorded values for {{ labels[metric()] }}.</p></section>
    } @else {
      @if (data(); as current) {
        <section class="latest-grid" aria-label="Latest rolling values">
        @for (window of current.windows; track window) {
          <article class="card latest"><span>{{ latestLabel(window) }}</span><strong>{{ latestValue(window) }}</strong><small>{{ latestCoverage(window) }}</small></article>
        }
        </section>

        <section class="card chart-card" aria-labelledby="rolling-chart-title">
        <div class="section-title"><div><span class="page-kicker">Daily timeline</span><h2 id="rolling-chart-title">{{ labels[current.metric] }}</h2></div><span>{{ current.range.from }} → {{ current.range.to }}</span></div>
        <p class="chart-help">Scroll or pinch to zoom; drag the range handles to extend or move the visible period. Full history is loaded once. Use Refresh data after recalculation.</p>
        <button type="button" class="secondary" (click)="load(true)">Refresh data</button>
        <div echarts [theme]="colorScheme.chartTheme()" (chartInit)="connectChart($event)" class="rolling-chart" [options]="chartOptions()" role="img" [attr.aria-label]="labels[current.metric] + ' rolling daily dynamics'"></div>
        </section>

        @for (window of current.windows; track window) {
          <section class="card chart-card" [attr.aria-labelledby]="'contribution-chart-title-' + window">
          <div class="section-title"><div><span class="page-kicker">Official score mix</span><h2 [id]="'contribution-chart-title-' + window">{{ window }}-day score contribution</h2></div><span>Average points per calendar day</span></div>
          <p class="chart-help">Each layer shows how much an activity contributes to the official trailing {{ window }}-day average, using the retained ledger components.</p>
          @if (hasContribution(window)) {
            <div echarts [theme]="colorScheme.chartTheme()" (chartInit)="connectChart($event)" class="contribution-chart" [options]="contributionChartOptions(window)" role="img" [attr.aria-label]="'Activity contributions to the trailing ' + window + '-day average official score'"></div>
          } @else {
            <p class="contribution-empty">No official score contributions exist in this range.</p>
          }
          </section>
        }

        <section class="card table-card" aria-label="Aggregate averages">
          <div class="pagination" aria-label="Dynamics table pagination">
            <label><input type="checkbox" [checked]="allTableDays()" (change)="allTableDays.set(checked($event)); tablePage.set(0)"> All available history</label>
            <label>Rows per page <select [value]="pageSize()" (change)="setPageSize(inputValue($event))"><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></label>
            <button type="button" class="secondary" [disabled]="tablePage() === 0" (click)="tablePage.set(0)">First</button>
            <button type="button" class="secondary" [disabled]="tablePage() === 0" (click)="tablePage.set(tablePage() - 1)">Previous</button>
            <span>Page {{ tablePage() + 1 }} / {{ pageCount() }} · {{ tableDates().length }} days</span>
            <button type="button" class="secondary" [disabled]="tablePage() + 1 >= pageCount()" (click)="tablePage.set(tablePage() + 1)">Next</button>
            <button type="button" class="secondary" [disabled]="tablePage() + 1 >= pageCount()" (click)="tablePage.set(pageCount() - 1)">Last</button>
          </div>
          <p class="table-help">Darker colors mean higher values within each metric and window over the table range. Typical positive values receive medium intensity; maxima receive the strongest shade. Uncolored cells are zero or missing.</p>
        @for (window of current.windows; track window) {
          <div class="aggregate-table-block">
            <div class="section-title"><div><span class="page-kicker">Selected cycle</span><h2 [id]="'rolling-table-title-' + window">{{ window }}-day aggregate averages</h2></div><span>Calendar-day averages</span></div>
            <p class="table-help">Each row is the rolling calendar-day average for that date. Missing dates remain visible; coverage is shown separately.</p>
            <div class="table-scroll" tabindex="0" role="region" [attr.aria-labelledby]="'rolling-table-title-' + window"><table>
              <thead><tr><th>Date</th><th>Coverage</th><th>Avg run</th><th>Avg swim</th><th>Avg bike</th><th>Avg steps</th><th>Avg points</th><th>Avg power points</th><th>Avg training points</th></tr></thead>
              <tbody>@for (row of tableRows()[window] ?? []; track row.date) {
                <tr><th scope="row">{{ row.date }}</th><td [class.incomplete]="row.recordedDays !== window">{{ row.recordedDays }}/{{ window }}</td>@for (metric of aggregateMetrics; track metric) { <td [style.background-color]="row.colors[metric]">{{ formatAggregate(row.values[metric], metric) }}</td> }</tr>
              }</tbody>
            </table></div>
          </div>
        }
        </section>
      }
    }
  `,
  styles: [`
    .page-heading { margin: 6px 0 22px; }.page-heading h1 { margin: 5px 0; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }.page-heading p, .semantics, .section-title > span { margin: 0; color: var(--text-muted); }.page-kicker { color: var(--link); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .controls { display: grid; gap: 12px; margin-bottom: 16px; }.controls .filter-bar { margin: 0; } fieldset { min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--border-accent); border-radius: 12px; } legend { padding: 0 6px; color: var(--text-secondary); font-size: 12px; font-weight: 750; }.window-picker { display: flex; flex-wrap: wrap; gap: 8px 18px; }.window-picker label { display: flex; align-items: center; gap: 6px; }.window-picker input { min-width: auto; }.semantics, .selection-message { font-size: 12px; }.selection-message { margin: 0; color: var(--danger); }
    .latest-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }.latest { display: grid; gap: 5px; }.latest span, .latest small { color: var(--text-muted); font-size: 12px; }.latest strong { color: var(--link); font-size: 27px; }.chart-card, .table-card { margin-bottom: 16px; }.section-title { display: flex; justify-content: space-between; align-items: end; gap: 16px; }.section-title h2 { margin: 4px 0 0; }.rolling-chart, .contribution-chart { width: 100%; height: min(52vh, 620px); min-height: 400px; }.chart-help, .table-help, .contribution-empty { margin: 8px 0 0; color: var(--text-muted); font-size: 12px; }
    .table-scroll { margin-top: 14px; max-height: 640px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; } table { width: 100%; border-collapse: collapse; white-space: nowrap; } th, td { padding: 10px 12px; border-bottom: 1px solid var(--border); text-align: right; } th:first-child { text-align: left; } thead th { position: sticky; top: 0; z-index: 1; background: var(--accent-surface); color: var(--text-muted); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }.incomplete { color: var(--warning); background: var(--warning-surface); }.state-card { display: grid; gap: 12px; justify-items: start; }.state-card.error { color: var(--danger); }
    .table-scroll:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .semantics summary { cursor: pointer; font-weight: 700; }
    .semantics p { margin-bottom: 0; }
    .pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }.pagination label { display: flex; align-items: center; gap: 6px; }.pagination input { min-width: auto; }
    .aggregate-table-block + .aggregate-table-block { margin-top: 22px; }
    @media (max-width: 700px) {
      .controls .filter-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .controls .filter-bar label:first-child { grid-column: 1 / -1; }
      .window-picker { gap: 0 14px; }
      .window-picker label { min-height: 44px; }
      .window-picker input { width: 18px; height: 18px; margin: 0; }
      .semantics summary { align-content: center; min-height: 44px; }
      .section-title { display: grid; gap: 6px; }
      .rolling-chart, .contribution-chart { height: 300px; min-height: 0; }
    }
  `],
})
export class RollingDynamicsPageComponent implements OnInit, OnDestroy {
  readonly colorScheme = inject(ColorSchemeService);
  readonly metrics = DYNAMICS_METRICS;
  readonly labels = DYNAMICS_LABELS;
  readonly availableWindows = ROLLING_WINDOWS;
  readonly quickRange = signal<QuickRange>(DEFAULT_ROLLING_QUICK_RANGE);
  readonly from = signal(defaultRange().from);
  readonly to = signal(defaultRange().to);
  readonly metric = signal<DynamicsMetric>('run');
  readonly windows = signal<RollingWindow[]>([30]);
  readonly aggregateMetrics = ROLLING_AGGREGATE_METRICS;
  readonly measure = signal<RollingDynamicsMeasure>('recordedDayAverage');
  readonly store = inject(DynamicsStore);
  readonly state = this.store.state;
  readonly errorMessage = this.store.errorMessage;
  readonly data = computed(() => historyMetric(this.store.history(), this.metric(), this.windows()));
  readonly selectedQuickRange = computed(() => { const range = this.store.history()?.range; return range && range.from === this.from() && range.to === this.to() ? 'all' : this.quickRange(); });
  readonly tablePage = signal(0);
  readonly pageSize = signal(50);
  readonly allTableDays = signal(false);
  readonly tableDates = computed(() => (this.store.history()?.dates ?? [])
    .map((date, index) => ({ date, index }))
    .filter(({ date }) => this.allTableDays() || (date >= this.from() && date <= this.to())).reverse());
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.tableDates().length / this.pageSize())));
  readonly heatRanges = computed(() => historyHeatRanges(this.store.history(), this.windows(), this.tableDates()));
  readonly tableRows = computed(() => historyTableRows(this.store.history(), this.windows(), this.tableDates(), this.tablePage(), this.pageSize(), this.heatRanges()));
  readonly contributionOptions = computed(() => Object.fromEntries(this.windows().map((window) => [window,
    scoreContributionChartOptions(this.data(), window, { from: this.from(), to: this.to() })])));
  readonly selectionMessage = signal<string | null>(null);
  readonly chartOptions = computed(() => rollingDynamicsChartOptions(this.data(), this.measure(), { from: this.from(), to: this.to() }));
  readonly reversedPoints = computed(() => [...(this.data()?.points ?? [])].reverse());
  readonly measureKey = computed(() => rollingMeasure(this.measure()));
  private readonly chartGroup = `dynamics-${++chartGroupSequence}`;
  connectChart(chart: EChartsType): void { chart.group = this.chartGroup; connect(this.chartGroup); }
  private readonly destroy$ = new Subject<void>();


  constructor(private readonly route: ActivatedRoute, private readonly router: Router) {}

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const range = readAnalyticsDateRange(params, defaultRange());
      const metric = readQueryEnum(params.get('metric'), DYNAMICS_METRICS, 'run');
      this.from.set(range.from);
      this.to.set(range.to);
      this.quickRange.set(range.quickRange);
      this.metric.set(metric);
      this.windows.set(readQueryNumberCsv(params.get('windows'), ROLLING_WINDOWS, [30]));
      this.measure.set(validRollingMeasure(
        readQueryEnum(params.get('measure'), ['total', 'recordedDayAverage', 'activeDays'] as const, 'recordedDayAverage'),
        metric,
      ));
      this.tablePage.set(0);
      this.load();
    });
  }

  ngOnDestroy(): void { disconnect(this.chartGroup); this.destroy$.next(); this.destroy$.complete(); }

  apply(): void {
    if (!isDateRangeOrdered(this.from(), this.to())) { this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return; }
    void this.router.navigate([], { relativeTo: this.route, queryParams: { from: this.from(), to: this.to(), metric: this.metric(), windows: this.windows().join(','), measure: this.measure() } });
  }

  load(force = false): void {
    if (!isDateRangeOrdered(this.from(), this.to())) { this.state.set('error'); this.errorMessage.set('From date must be on or before the to date.'); return; }
    this.store.load(force);
  }

  toggleWindow(window: RollingWindow, selected: boolean): void {
    const current = this.windows();
    if (!selected && current.length === 1) { this.selectionMessage.set('Keep at least one trailing window selected.'); return; }
    this.selectionMessage.set(null);
    this.windows.set((selected ? [...current, window] : current.filter((value) => value !== window)).sort((a, b) => a - b));
  }

  setQuickRange(value: string): void {
    if (!QUICK_RANGE_VALUES.includes(value as QuickRange)) return;
    const range = value as QuickRange;
    this.quickRange.set(range);
    if (range === 'custom') return;
    const dates = range === 'all' ? this.store.history()?.range ?? defaultRange() : quickRangeDates(range);
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

  setMetric(value: string): void {
    const metric = validMetric(value);
    if (!metric) return;
    this.metric.set(metric);
    if (metric === 'score' && this.measure() === 'activeDays') this.measure.set('total');
  }
  setMeasure(value: string): void {
    if (value === 'total' || value === 'recordedDayAverage' || (value === 'activeDays' && this.metric() !== 'score')) this.measure.set(value);
  }
  inputValue(event: Event): string { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  format(value: number | null | undefined): string { return formatRollingValue(value, this.data()!.unit); }
  formatMeasure(value: number | null | undefined): string { return formatRollingMeasureValue(value, this.measure(), this.data()!.unit); }
  setPageSize(value: string): void { const size = Number(value); if ([50, 100, 200].includes(size)) { this.pageSize.set(size); this.tablePage.set(0); } }
  hasContribution(window: RollingWindow): boolean { return Boolean(this.data()?.scoreContributions[window]?.categories.length); }
  contributionChartOptions(window: RollingWindow) { return this.contributionOptions()[window] ?? {}; }
  formatAggregate(value: number | null | undefined, metric: RollingAggregateMetric): string {
    const unit = metricUnit(metric);
    return formatRollingValue(value, unit);
  }
  latestLabel(window: RollingWindow): string { return this.measure() === 'activeDays' ? `Active days in last ${window}` : `${window} day ${this.measure() === 'total' ? 'total' : 'avg'}`; }
  latestValue(window: RollingWindow): string { const value = this.reversedPoints().find((point) => point.date <= this.to())?.windows[window]?.[this.measureKey()]; return this.formatMeasure(value); }
  latestCoverage(window: RollingWindow): string { const value = this.reversedPoints().find((point) => point.date <= this.to())?.windows[window]; return value ? `${value.recordedDays} / ${value.windowDays} days recorded${value.complete ? '' : ' · incomplete'}` : 'No coverage'; }
}

function validMetric(value: string | null): DynamicsMetric | null { return value && DYNAMICS_METRICS.includes(value as DynamicsMetric) ? value as DynamicsMetric : null; }
function validRollingMeasure(value: string | null, metric: DynamicsMetric): RollingDynamicsMeasure {
  if (value === 'activeDays') return metric === 'score' ? 'total' : 'activeDays';
  return value === 'total' ? 'total' : 'recordedDayAverage';
}
function defaultRange(): { from: string; to: string } { return quickRangeDates(DEFAULT_ROLLING_QUICK_RANGE); }
