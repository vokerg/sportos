import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivityListComponent } from './activity-list.component';
import type { ActivitiesQuery, ActivitySource, ActivityType } from './activities-api.service';
import { ActivitiesStore } from './activities.store';
import {
  BIKE_SPEED_OPTIONS, DEFAULT_QUICK_RANGE, DISTANCE_OPTIONS_M, QUICK_RANGE_OPTIONS,
  RUN_PACE_OPTIONS, SOURCE_OPTIONS, SWIM_PACE_OPTIONS, TYPE_OPTIONS,
  distance, duration, isQuickRange, matchQuickRange, quickRangeDates, sportDistance, type QuickRange,
} from './activity.view-model';

@Component({
  selector: 'sportos-activities-page', standalone: true, imports: [ActivityListComponent], providers: [ActivitiesStore],
  template: `
    <header><span class="page-kicker">Training history</span><h1>Activities</h1><p>Canonical activities from your imports and connected sources.</p></header>
    <form class="card filters" (submit)="apply($event)" aria-label="Activity filters">
      <div class="filter-row">
        <label>Quick range <select [value]="quickRange()" (change)="setQuickRange($any($event.target).value)">@for (option of quickRangeOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label>
        <label>From <input type="date" [value]="from()" (change)="setFrom($any($event.target).value)" /></label>
        <label>To <input type="date" [value]="to()" (change)="setTo($any($event.target).value)" /></label>
        <label>Activity type <select [value]="activityType()" (change)="setActivityType($any($event.target).value)">@for (option of typeOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label>
        <label>Source <select [value]="source()" (change)="source.set($any($event.target).value)">@for (option of sourceOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label>
      </div>
      @if (isDistanceSport()) {
        <fieldset class="sport-filters"><legend>{{ sportLabel() }} filters</legend>
          <label>Minimum distance <select [value]="minDistanceM()" (change)="minDistanceM.set(+$any($event.target).value)">
            <option value="0">Any distance</option>
            @for (metres of distanceOptions(); track metres) { @if (metres > 0) { <option [value]="metres">At least {{ sportDistance(metres, selectedDistanceSport()) }}</option> } }
          </select></label>
          @if (activityType() === 'run') {
            <label>Average pace <select [value]="paceUnderSPerKm()" (change)="paceUnderSPerKm.set(+$any($event.target).value)">@for (option of runPaceOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label>
          } @else if (activityType() === 'bike') {
            <label>Average speed <select [value]="minSpeedKmh()" (change)="minSpeedKmh.set(+$any($event.target).value)">
              @for (speed of bikeSpeedOptions; track speed) { <option [value]="speed">{{ speed ? 'At least ' + speed + ' km/h' : 'Any speed' }}</option> }
            </select></label>
          } @else if (activityType() === 'swim') {
            <label>Average pace <select [value]="swimPaceUnderSPer100m()" (change)="swimPaceUnderSPer100m.set(+$any($event.target).value)">@for (option of swimPaceOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label>
          }
        </fieldset>
      }
      <div class="actions"><button type="submit">Apply filters</button><button class="secondary" type="button" (click)="reset()">Reset</button></div>
    </form>
    @if (store.state() === 'loading') { <section class="card" role="status">Loading activities…</section> }
    @else if (store.state() === 'error') { <section class="card" role="alert">Could not load activities. <button type="button" (click)="load()">Try again</button></section> }
    @else { @if (store.result(); as data) {
      <section class="summary" aria-label="Filtered activity summary"><strong>{{ data.summary.count }} activities</strong><span>{{ duration(data.summary.durationS) }} total duration</span><span>{{ distance(data.summary.distanceM) }} total distance</span></section>
      @if (data.items.length === 0) { <section class="card">No activities match these filters.</section> }
      @else { <sportos-activity-list [activities]="data.items" /> }
      @if (data.offset > 0 || data.offset + data.items.length < data.summary.count) {
        <nav class="pages" aria-label="Activity pages"><button type="button" [disabled]="data.offset === 0" (click)="page(Math.max(0, data.offset - data.limit))">Previous</button><span>{{ data.offset + 1 }}–{{ data.offset + data.items.length }} of {{ data.summary.count }}</span><button type="button" [disabled]="data.offset + data.items.length >= data.summary.count" (click)="page(data.offset + data.limit)">Next</button></nav>
      }
    } }
  `,
  styles: [`
    header { margin: 4px 0 18px; } h1 { margin: 3px 0; } p { color: #667085; margin: 0; }
    .page-kicker { color: #5368ae; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .filters { display: grid; gap: 14px; margin-bottom: 14px; }
    .filter-row,.sport-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
    .sport-filters { border: 1px solid #dbe4f5; border-radius: 10px; padding: 10px 14px 14px; background: #f8faff; }
    .sport-filters legend { color: #344054; font-size: 13px; font-weight: 800; padding: 0 5px; }
    label { display: grid; gap: 5px; color: #475467; font-size: 12px; font-weight: 700; }
    input,select { min-height: 36px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 7px; background: white; color: #172033; }
    .actions { display: flex; gap: 8px; }.summary,.pages { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; margin: 12px 0; }
    .summary span,.pages span { color: #667085; }.pages { justify-content: center; }
  `],
})
export class ActivitiesPageComponent implements OnInit, OnDestroy {
  readonly from = signal(''); readonly to = signal(''); readonly quickRange = signal<QuickRange>(DEFAULT_QUICK_RANGE);
  readonly activityType = signal(''); readonly source = signal('strava');
  readonly minDistanceM = signal(0); readonly paceUnderSPerKm = signal(0);
  readonly minSpeedKmh = signal(0); readonly swimPaceUnderSPer100m = signal(0);
  readonly typeOptions = TYPE_OPTIONS; readonly sourceOptions = SOURCE_OPTIONS;
  readonly quickRangeOptions = QUICK_RANGE_OPTIONS; readonly runPaceOptions = RUN_PACE_OPTIONS;
  readonly bikeSpeedOptions = BIKE_SPEED_OPTIONS; readonly swimPaceOptions = SWIM_PACE_OPTIONS;
  readonly distance = distance; readonly sportDistance = sportDistance; readonly duration = duration; readonly Math = Math;
  private routeSubscription?: Subscription;
  private offset = 0;

  constructor(readonly store: ActivitiesStore, private readonly route: ActivatedRoute, private readonly router: Router) {}
  ngOnInit(): void {
    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      const requestedRange = params.get('range');
      if (!params.has('from') && !params.has('to') && !requestedRange) {
        const dates = quickRangeDates(DEFAULT_QUICK_RANGE);
        this.from.set(dates.from); this.to.set(dates.to); this.quickRange.set(DEFAULT_QUICK_RANGE);
      } else if (requestedRange && requestedRange !== 'custom' && isQuickRange(requestedRange)) {
        const dates = quickRangeDates(requestedRange as Exclude<QuickRange, 'custom'>);
        this.from.set(dates.from); this.to.set(dates.to); this.quickRange.set(requestedRange as QuickRange);
      } else {
        this.from.set(params.get('from') ?? ''); this.to.set(params.get('to') ?? '');
        this.quickRange.set(requestedRange === 'custom' ? 'custom' : matchQuickRange(this.from(), this.to()));
      }
      this.activityType.set(params.get('activityType') ?? '');
      this.source.set(params.get('source') ?? 'strava');
      this.minDistanceM.set(Number(params.get('minDistanceM') ?? 0));
      this.paceUnderSPerKm.set(Number(params.get('paceUnderSPerKm') ?? 0));
      this.minSpeedKmh.set(Number(params.get('minSpeedKmh') ?? 0));
      this.swimPaceUnderSPer100m.set(Number(params.get('swimPaceUnderSPer100m') ?? 0));
      this.offset = Number(params.get('offset') ?? 0); this.load();
    });
  }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.store.destroy(); }
  isDistanceSport(): boolean { return ['run', 'bike', 'swim'].includes(this.activityType()); }
  selectedDistanceSport(): ActivityType { return this.activityType() as ActivityType; }
  sportLabel(): string { return this.typeOptions.find((option) => option.value === this.activityType())?.label ?? ''; }
  distanceOptions(): readonly number[] { return DISTANCE_OPTIONS_M[this.activityType() as keyof typeof DISTANCE_OPTIONS_M] ?? []; }
  setFrom(value: string): void { this.from.set(value); this.quickRange.set('custom'); }
  setTo(value: string): void { this.to.set(value); this.quickRange.set('custom'); }
  setQuickRange(value: string): void {
    if (!isQuickRange(value)) return;
    this.quickRange.set(value as QuickRange);
    if (value === 'custom') return;
    const dates = quickRangeDates(value as Exclude<QuickRange, 'custom'>);
    this.from.set(dates.from); this.to.set(dates.to); this.navigate(0);
  }
  setActivityType(value: string): void {
    if (value === this.activityType()) return;
    this.activityType.set(value);
    this.minDistanceM.set(0); this.paceUnderSPerKm.set(0); this.minSpeedKmh.set(0); this.swimPaceUnderSPer100m.set(0);
  }
  apply(event: Event): void { event.preventDefault(); this.navigate(0); }
  reset(): void {
    const dates = quickRangeDates(DEFAULT_QUICK_RANGE);
    this.from.set(dates.from); this.to.set(dates.to); this.quickRange.set(DEFAULT_QUICK_RANGE);
    this.activityType.set(''); this.source.set('strava'); this.minDistanceM.set(0);
    this.paceUnderSPerKm.set(0); this.minSpeedKmh.set(0); this.swimPaceUnderSPer100m.set(0);
    this.navigate(0);
  }
  page(offset: number): void { this.navigate(offset); }
  private navigate(offset: number): void {
    void this.router.navigate(['/activities'], { queryParams: {
      range: this.quickRange(), from: this.from() || null, to: this.to() || null,
      activityType: this.activityType() || null, source: this.source(), offset: offset || null,
      minDistanceM: this.isDistanceSport() && this.minDistanceM() || null,
      paceUnderSPerKm: this.activityType() === 'run' && this.paceUnderSPerKm() || null,
      minSpeedKmh: this.activityType() === 'bike' && this.minSpeedKmh() || null,
      swimPaceUnderSPer100m: this.activityType() === 'swim' && this.swimPaceUnderSPer100m() || null,
    } });
  }
  load(): void {
    const query: ActivitiesQuery = { limit: 50, offset: this.offset };
    if (this.from()) query.from = this.from(); if (this.to()) query.to = this.to();
    if (this.activityType()) query.activityType = this.activityType() as ActivityType;
    if (this.source() !== 'all') query.source = this.source() as ActivitySource;
    if (this.isDistanceSport() && this.minDistanceM()) query.minDistanceM = this.minDistanceM();
    if (this.activityType() === 'run' && this.paceUnderSPerKm()) query.paceUnderSPerKm = this.paceUnderSPerKm();
    if (this.activityType() === 'bike' && this.minSpeedKmh()) query.minAvgSpeedMps = this.minSpeedKmh() / 3.6;
    if (this.activityType() === 'swim' && this.swimPaceUnderSPer100m()) query.swimPaceUnderSPer100m = this.swimPaceUnderSPer100m();
    this.store.load(query);
  }
}
