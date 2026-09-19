import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivityListComponent } from './activity-list.component';
import { ActivitiesApiService, type ActivitiesQuery, type ActivitiesResponse, type ActivitySource, type ActivityType } from './activities-api.service';
import { distance, duration, SOURCE_OPTIONS, TYPE_OPTIONS } from './activity.view-model';

@Component({
  selector: 'sportos-activities-page', standalone: true, imports: [ActivityListComponent],
  template: `
    <header><span class="page-kicker">Training history</span><h1>Activities</h1><p>Canonical activities from your imports and connected sources.</p></header>
    <form class="card filters" (submit)="apply($event)">
      <label>From <input type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></label>
      <label>To <input type="date" [value]="to()" (change)="to.set($any($event.target).value)" /></label>
      <label>Activity type <select [value]="activityType()" (change)="activityType.set($any($event.target).value)">@for (option of typeOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label>
      <label>Source <select [value]="source()" (change)="source.set($any($event.target).value)">@for (option of sourceOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label>
      <button type="submit">Apply filters</button>
    </form>
    @if (state() === 'loading') { <section class="card" role="status">Loading activities…</section> }
    @else if (state() === 'error') { <section class="card" role="alert">Could not load activities. <button type="button" (click)="load()">Try again</button></section> }
    @else { @if (result(); as data) {
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
    .filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-bottom: 14px; }
    label { display: grid; gap: 5px; color: #475467; font-size: 12px; font-weight: 700; }
    input,select { min-height: 36px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 7px; background: white; color: #172033; }
    .summary,.pages { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: center; margin: 12px 0; }
    .summary span,.pages span { color: #667085; }.pages { justify-content: center; }
  `],
})
export class ActivitiesPageComponent implements OnInit, OnDestroy {
  readonly from = signal(''); readonly to = signal(''); readonly activityType = signal(''); readonly source = signal('');
  readonly state = signal<'loading' | 'loaded' | 'error'>('loading');
  readonly result = signal<ActivitiesResponse | null>(null);
  readonly typeOptions = TYPE_OPTIONS; readonly sourceOptions = SOURCE_OPTIONS;
  readonly distance = distance; readonly duration = duration; readonly Math = Math;
  private routeSubscription?: Subscription; private requestSubscription?: Subscription;
  private offset = 0;

  constructor(private readonly api: ActivitiesApiService, private readonly route: ActivatedRoute, private readonly router: Router) {}
  ngOnInit(): void {
    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      this.from.set(params.get('from') ?? ''); this.to.set(params.get('to') ?? '');
      this.activityType.set(params.get('activityType') ?? ''); this.source.set(params.get('source') ?? '');
      this.offset = Number(params.get('offset') ?? 0); this.load();
    });
  }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.requestSubscription?.unsubscribe(); }
  apply(event: Event): void { event.preventDefault(); this.navigate(0); }
  page(offset: number): void { this.navigate(offset); }
  private navigate(offset: number): void {
    void this.router.navigate(['/activities'], { queryParams: {
      from: this.from() || null, to: this.to() || null, activityType: this.activityType() || null,
      source: this.source() || null, offset: offset || null,
    } });
  }
  load(): void {
    this.requestSubscription?.unsubscribe(); this.state.set('loading'); this.result.set(null);
    const query: ActivitiesQuery = { limit: 50, offset: this.offset };
    if (this.from()) query.from = this.from(); if (this.to()) query.to = this.to();
    if (this.activityType()) query.activityType = this.activityType() as ActivityType;
    if (this.source()) query.source = this.source() as ActivitySource;
    this.requestSubscription = this.api.list(query).subscribe({
      next: (result) => { this.result.set(result); this.state.set('loaded'); },
      error: () => this.state.set('error'),
    });
  }
}
