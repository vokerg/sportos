import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivitiesApiService, type ActivityDetail } from './activities-api.service';
import { metrics, startTime, title } from './activity.view-model';

@Component({
  selector: 'sportos-activity-detail-page', standalone: true, imports: [RouterLink],
  template: `
    <nav class="breadcrumb"><a routerLink="/activities">Activities</a> › Activity</nav>
    @if (state() === 'loading') { <section class="card" role="status">Loading activity…</section> }
    @else if (state() === 'error') { <section class="card" role="alert">Could not load this activity. <button type="button" (click)="load()">Try again</button></section> }
    @else if (state() === 'missing') { <section class="card">Activity not found.</section> }
    @else { @if (activity(); as item) {
      <header><span class="page-kicker">Canonical activity</span><h1>{{ title(item) }} @if (item.subtype && item.subtype !== 'unknown') { <small>· {{ item.subtype }}</small> }</h1><p>{{ item.activity_date }} @if (startTime(item.start_time)) { · {{ startTime(item.start_time) }} } · {{ item.source.replaceAll('_', ' ') }}</p></header>
      <section class="card"><h2>Activity metrics</h2><dl class="metrics">@for (metric of metrics(item, true); track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> }</dl>
        @if (item.notes) { <h3>Notes</h3><p class="notes">{{ item.notes }}</p> }
      </section>
      <details class="card provenance"><summary>Source and provenance</summary><dl>
        <div><dt>Source</dt><dd>{{ item.source }}</dd></div>
        @if (item.source_activity_id) { <div><dt>Source activity ID</dt><dd>{{ item.source_activity_id }}</dd></div> }
        <div><dt>Canonical activity ID</dt><dd>{{ item.id }}</dd></div>
        @if (item.provenance.sourceRecordId) { <div><dt>Source record ID</dt><dd>{{ item.provenance.sourceRecordId }}</dd></div> }
        @if (item.provenance.sourceRecordSource) { <div><dt>Source record type</dt><dd>{{ item.provenance.sourceRecordSource }}</dd></div> }
      </dl></details>
    } }
  `,
  styles: [`
    .breadcrumb { margin-bottom: 18px; color: #667085; }.breadcrumb a { color: #1d4ed8; }
    header { margin-bottom: 18px; } h1 { margin: 4px 0; } h1 small { font-size: 18px; font-weight: 500; color: #667085; }
    header p { margin: 0; color: #667085; text-transform: capitalize; }.page-kicker { color: #5368ae; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 18px; }
    dt { color: #667085; font-size: 12px; } dd { margin: 3px 0 0; font-weight: 700; overflow-wrap: anywhere; }
    .notes { white-space: pre-wrap; }.provenance { margin-top: 16px; }.provenance summary { cursor: pointer; font-weight: 700; }
    .provenance dl { display: grid; gap: 10px; }
  `],
})
export class ActivityDetailPageComponent implements OnInit, OnDestroy {
  readonly state = signal<'loading' | 'loaded' | 'missing' | 'error'>('loading');
  readonly activity = signal<ActivityDetail | null>(null);
  readonly metrics = metrics; readonly startTime = startTime; readonly title = title;
  private id = ''; private routeSubscription?: Subscription; private requestSubscription?: Subscription;
  constructor(private readonly api: ActivitiesApiService, private readonly route: ActivatedRoute) {}
  ngOnInit(): void { this.routeSubscription = this.route.paramMap.subscribe((params) => { this.id = params.get('id') ?? ''; this.load(); }); }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.requestSubscription?.unsubscribe(); }
  load(): void {
    this.requestSubscription?.unsubscribe(); this.activity.set(null); this.state.set('loading');
    this.requestSubscription = this.api.detail(this.id).subscribe({
      next: (activity) => { this.activity.set(activity); this.state.set('loaded'); },
      error: (error: unknown) => this.state.set(error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error'),
    });
  }
}
