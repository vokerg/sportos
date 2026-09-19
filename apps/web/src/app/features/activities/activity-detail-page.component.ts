import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivitiesApiService, type ActivityDetail } from './activities-api.service';
import { metricGroups, startTime, title } from './activity.view-model';

@Component({
  selector: 'sportos-activity-detail-page', standalone: true, imports: [RouterLink],
  template: `
    <nav class="breadcrumb"><a routerLink="/activities">Activities</a> › Activity</nav>
    @if (state() === 'loading') { <section class="card" role="status">Loading activity…</section> }
    @else if (state() === 'error') { <section class="card" role="alert">Could not load this activity. <button type="button" (click)="load()">Try again</button></section> }
    @else if (state() === 'missing') { <section class="card">Activity not found.</section> }
    @else { @if (activity(); as item) {
      <header><span class="page-kicker">Canonical activity</span><h1>{{ title(item) }} @if (item.subtype && item.subtype !== 'unknown') { <small>· {{ item.subtype }}</small> }</h1><p>{{ item.activity_date }} @if (startTime(item.start_time)) { · {{ startTime(item.start_time) }} } · {{ item.source.replaceAll('_', ' ') }}</p>
        @if (item.source === 'strava' && item.notes) { <p class="source-name">{{ item.notes }}</p> }
      </header>
      <div class="metric-sections">@for (group of metricGroups(item); track group.title) {
        <section class="card"><h2>{{ group.title }}</h2><dl class="metrics">@for (metric of group.items; track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> }</dl></section>
      }</div>
      @if (item.notes && item.source !== 'strava') { <section class="card notes-card"><h2>Notes</h2><p class="notes">{{ item.notes }}</p></section> }
      <details class="card provenance"><summary>Source and provenance</summary><dl>
        <div><dt>Source</dt><dd>{{ item.source }}</dd></div>
        @if (item.source_activity_id) { <div><dt>Source activity ID</dt><dd>{{ item.source_activity_id }}</dd></div> }
        <div><dt>Canonical activity ID</dt><dd>{{ item.id }}</dd></div>
        @if (item.provenance.sourceRecordId) { <div><dt>Source record ID</dt><dd>{{ item.provenance.sourceRecordId }}</dd></div> }
        @if (item.provenance.sourceRecordSource) { <div><dt>Source record type</dt><dd>{{ item.provenance.sourceRecordSource }}</dd></div> }
      </dl></details>
      @if (item.provenance.sourceRecordId) {
        <details class="card source-json" (toggle)="onSourceToggle($event)">
          <summary>Raw source JSON (advanced)</summary>
          <p>Retained source data for this activity. It may include location and other private details.</p>
          @if (sourceState() === 'loading') { <p role="status">Loading source JSON…</p> }
          @else if (sourceState() === 'error') { <p role="alert">Could not load source JSON. <button type="button" (click)="loadSourceJson()">Try again</button></p> }
          @else if (sourceState() === 'missing') { <p>Source JSON is unavailable.</p> }
          @else if (sourceState() === 'loaded') { <pre>{{ sourceJson() }}</pre> }
        </details>
      }
    } }
  `,
  styles: [`
    .breadcrumb { margin-bottom: 18px; color: #667085; }.breadcrumb a { color: #1d4ed8; }
    header { margin-bottom: 18px; } h1 { margin: 4px 0; } h1 small { font-size: 18px; font-weight: 500; color: #667085; }
    header p { margin: 0; color: #667085; text-transform: capitalize; }.source-name { margin-top: 10px; color: #344054; font-size: 16px; text-transform: none; }.page-kicker { color: #5368ae; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .metric-sections { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); }.metric-sections h2 { margin-top: 0; font-size: 17px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 18px; }
    dt { color: #667085; font-size: 12px; } dd { margin: 3px 0 0; font-weight: 700; overflow-wrap: anywhere; }
    .notes-card { margin-top: 12px; }.notes { white-space: pre-wrap; }.provenance { margin-top: 16px; }.provenance summary { cursor: pointer; font-weight: 700; }
    .provenance dl { display: grid; gap: 10px; }
    .source-json { margin-top: 12px; }.source-json summary { cursor: pointer; font-weight: 700; }
    .source-json p { color: #667085; }.source-json pre { max-height: 520px; overflow: auto; padding: 16px; border-radius: 8px; background: #101828; color: #f2f4f7; font-size: 12px; line-height: 1.5; white-space: pre; }
  `],
})
export class ActivityDetailPageComponent implements OnInit, OnDestroy {
  readonly state = signal<'loading' | 'loaded' | 'missing' | 'error'>('loading');
  readonly activity = signal<ActivityDetail | null>(null);
  readonly sourceState = signal<'idle' | 'loading' | 'loaded' | 'missing' | 'error'>('idle');
  readonly sourceJson = signal<string | null>(null);
  readonly metricGroups = metricGroups; readonly startTime = startTime; readonly title = title;
  private id = ''; private routeSubscription?: Subscription; private requestSubscription?: Subscription; private sourceSubscription?: Subscription;
  constructor(private readonly api: ActivitiesApiService, private readonly route: ActivatedRoute) {}
  ngOnInit(): void { this.routeSubscription = this.route.paramMap.subscribe((params) => { this.id = params.get('id') ?? ''; this.load(); }); }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.requestSubscription?.unsubscribe(); this.sourceSubscription?.unsubscribe(); }
  load(): void {
    this.requestSubscription?.unsubscribe(); this.sourceSubscription?.unsubscribe();
    this.activity.set(null); this.sourceJson.set(null); this.sourceState.set('idle'); this.state.set('loading');
    this.requestSubscription = this.api.detail(this.id).subscribe({
      next: (activity) => { this.activity.set(activity); this.state.set('loaded'); },
      error: (error: unknown) => this.state.set(error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error'),
    });
  }
  onSourceToggle(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && this.sourceState() === 'idle') this.loadSourceJson();
  }
  loadSourceJson(): void {
    if (!this.activity()?.provenance.sourceRecordId) return;
    this.sourceSubscription?.unsubscribe(); this.sourceState.set('loading');
    this.sourceSubscription = this.api.sourceJson(this.id).subscribe({
      next: (source) => { this.sourceJson.set(JSON.stringify(source.rawJson, null, 2) ?? 'null'); this.sourceState.set('loaded'); },
      error: (error: unknown) => this.sourceState.set(error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error'),
    });
  }
}
