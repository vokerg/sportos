import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDate } from '../../../date-time';
import { localCalendarDate } from '../../../shared/util/analytics-query-state';
import { formatDurationClock } from '../../../shared/util/duration';
import {
  dailyRecordValue, RECORD_METRIC_LABELS, recordDistance, type RecordMetric,
} from '../model/personal-records.models';
import { PersonalRecordsStore } from '../state/personal-records.store';

const VIEWS = [
  { key: 'running', name: 'Running' },
  { key: 'cycling', name: 'Cycling' },
  { key: 'swimming', name: 'Swimming' },
  { key: 'daily', name: 'Daily & rolling' },
] as const;
type RecordView = typeof VIEWS[number]['key'];
const METRICS = Object.keys(RECORD_METRIC_LABELS) as RecordMetric[];

@Component({
  selector: 'sportos-personal-records-page',
  standalone: true,
  imports: [RouterLink],
  providers: [PersonalRecordsStore],
  template: `
    <section class="records-page" aria-labelledby="records-title">
      <a routerLink="/stats">← Stats</a>
      <header class="page-heading">
        <h1 id="records-title">Personal Records</h1>
      </header>

      <nav class="views" aria-label="Record categories">
        @for (option of views; track option.key) {
          <button type="button" class="secondary" [attr.aria-pressed]="view() === option.key"
            (click)="view.set(option.key)">{{ option.name }}</button>
        }
      </nav>

      @switch (store.state()) {
        @case ('loading') {
          <p class="card status" role="status">Loading personal records…</p>
        }
        @case ('error') {
          <div class="card status" role="alert">
            <p>Personal records could not be loaded.</p>
            <button type="button" (click)="store.load()">Retry</button>
          </div>
        }
        @case ('loaded') {
          @if (view() === 'daily') {
            <div class="section-heading">
              <div>
                <h2>Daily & rolling highs</h2>
                <p>Rolling highs are averages per calendar day, grouped by the year the window ended.</p>
              </div>
              <div class="filters">
                <label>Metric
                  <select #metricInput [value]="metric()" (change)="selectMetric(metricInput.value)">
                    @for (option of metrics; track option) {
                      <option [value]="option">{{ metricLabels[option] }}</option>
                    }
                  </select>
                </label>
                <label>Period
                  <select #periodInput [value]="period()" (change)="period.set(periodInput.value)">
                    <option value="all">All time</option>
                    @for (year of years(); track year) { <option [value]="year">{{ year }}</option> }
                  </select>
                </label>
              </div>
            </div>
            <div class="record-grid">
              @for (record of daily(); track record.windowDays) {
                <article class="card record">
                  <h3>{{ record.windowDays === 1 ? 'Best day' : record.windowDays + '-day average' }}</h3>
                  <strong>{{ dailyValue(record) }}</strong>
                  @if (record.windowDays === 1) {
                    <a [routerLink]="['/daily', record.date]">{{ date(record.date) }}</a>
                  } @else {
                    <span>Ended {{ date(record.date) }}</span>
                  }
                  @if (record.recordedDays < record.windowDays) {
                    <small>{{ record.windowDays - record.recordedDays }} missing {{ record.windowDays - record.recordedDays === 1 ? 'day' : 'days' }} in this window</small>
                  }
                  @if (record.date === today) { <small>Today · provisional</small> }
                </article>
              } @empty {
                <p class="card status">No highs recorded for this metric and period.</p>
              }
            </div>
          } @else {
            <div class="section-heading">
              <div>
                <h2>{{ sportTitle() }} · All time</h2>
                @if (view() === 'running') {
                  <p>Fastest retained times by distance, from historical records and measured efforts.</p>
                } @else {
                  <p>Fastest elapsed times for full sessions within 1% of each distance.</p>
                }
              </div>
              @if (view() === 'running') { <a routerLink="/run-lab">Open Run Lab →</a> }
            </div>
            <div class="record-grid">
              @for (record of sports(); track record.targetDistanceM) {
                <article class="card record">
                  <h3>{{ distance(record.targetDistanceM, view() === 'swimming') }}</h3>
                  <strong>{{ duration(record.durationS) }}</strong>
                  @if (record.activityId) {
                    <a [routerLink]="['/activity', record.activityId]">{{ date(record.date) }}</a>
                  } @else {
                    <span>{{ date(record.date) }}</span>
                  }
                  @if (record.source) {
                    <small>{{ record.source === 'excel' ? 'Historical Excel record' : record.source === 'strava' ? 'Strava measured effort' : 'Garmin measured effort' }}</small>
                  }
                  @if (record.distanceM !== undefined && record.distanceM !== record.targetDistanceM) {
                    <small>Session distance {{ distance(record.distanceM, view() === 'swimming') }}</small>
                  }
                  @if (record.date === today) { <small>Today · provisional</small> }
                </article>
              } @empty {
                <p class="card status">No qualifying {{ sportTitle().toLowerCase() }} records in retained history.</p>
              }
            </div>
          }
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .records-page { max-width: 1100px; margin: 0 auto; }
    h1 { margin: 8px 0 20px; font-size: clamp(28px, 3vw, 40px); letter-spacing: -.035em; }
    h2, h3, p { margin: 0; }
    h2 { font-size: 22px; }
    p, small { color: var(--text-muted); }
    .views, .filters { display: flex; flex-wrap: wrap; gap: 8px; }
    .views { padding-bottom: 14px; border-bottom: 1px solid var(--border); }
    .views button[aria-pressed="true"] { color: var(--link); border-color: var(--link); background: var(--accent-surface); }
    .section-heading { display: flex; align-items: end; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 22px 0 14px; }
    .section-heading p { margin-top: 5px; font-size: 14px; }
    .filters label { display: grid; gap: 4px; color: var(--text-muted); font-size: 12px; }
    .record-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 205px), 1fr)); gap: 12px; }
    .record { display: grid; align-content: start; gap: 5px; }
    .record h3 { font-size: 14px; }
    .record strong { font-size: clamp(23px, 3vw, 32px); font-variant-numeric: tabular-nums; letter-spacing: -.025em; }
    .record a { justify-self: start; }
    .record span { color: var(--text-secondary); }
    .record small { font-size: 12px; }
    .status { margin-top: 14px; grid-column: 1 / -1; }
    .status button { margin-top: 12px; }
    @media (max-width: 500px) {
      .views { display: grid; grid-template-columns: 1fr 1fr; }
      .views button { min-height: 44px; }
      .record-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .record { padding: 12px; }
    }
    @media (max-width: 340px) { .record-grid { grid-template-columns: 1fr; } }
  `],
})
export class PersonalRecordsPageComponent implements OnInit {
  readonly store = inject(PersonalRecordsStore);
  readonly today = localCalendarDate();
  readonly views = VIEWS;
  readonly metrics = METRICS;
  readonly metricLabels = RECORD_METRIC_LABELS;
  readonly view = signal<RecordView>('running');
  readonly metric = signal<RecordMetric>('score');
  readonly period = signal('all');
  readonly years = computed(() => [...new Set(this.store.data()?.daily.map(record => record.period) ?? [])]
    .filter(period => period !== 'all').sort().reverse());
  readonly daily = computed(() => (this.store.data()?.daily ?? [])
    .filter(record => record.period === this.period() && record.metric === this.metric())
    .sort((left, right) => left.windowDays - right.windowDays));
  readonly sports = computed(() => {
    const view = this.view();
    return view === 'daily' ? [] : this.store.data()?.[view] ?? [];
  });
  readonly sportTitle = computed(() => this.views.find(option => option.key === this.view())!.name);
  readonly date = formatDate;
  readonly duration = formatDurationClock;
  readonly distance = recordDistance;
  readonly dailyValue = dailyRecordValue;

  ngOnInit(): void { this.store.load(); }

  selectMetric(metric: string): void {
    if (Object.hasOwn(RECORD_METRIC_LABELS, metric)) this.metric.set(metric as RecordMetric);
  }
}
