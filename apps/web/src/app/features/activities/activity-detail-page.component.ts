import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivitiesApiService } from './activities-api.service';
import { ActivityDetailStore } from './state/activity-detail.store';
import { exerciseSetRows, fitMetrics, stravaMetrics } from './provider-detail.view-model';
import { metricGroups, startTime, subtypeLabel, title } from './activity.view-model';

@Component({
  selector: 'sportos-activity-detail-page', standalone: true, imports: [RouterLink], providers: [ActivityDetailStore],
  template: `
    <nav class="breadcrumb"><a routerLink="/activities">Activities</a> › Activity</nav>
    @if (state() === 'loading') { <section class="card" role="status">Loading activity…</section> }
    @else if (state() === 'error') { <section class="card" role="alert">Could not load this activity. <button type="button" (click)="load()">Try again</button></section> }
    @else if (state() === 'missing') { <section class="card">Activity not found.</section> }
    @else { @if (activity(); as item) {
      <header><span class="page-kicker">Canonical activity</span><h1>{{ title(item) }} @if (item.subtype && item.subtype !== 'unknown') { <small>· {{ subtypeLabel(item.subtype) }}</small> }</h1><p>{{ item.activity_date }} @if (startTime(item.start_time)) { · {{ startTime(item.start_time) }} } · {{ item.source.replaceAll('_', ' ') }}</p>
        @if (item.source === 'strava' && item.notes) { <p class="source-name">{{ item.notes }}</p> }
      </header>
      <div class="metric-sections">@for (group of metricGroups(item); track group.title) {
        <section class="card"><h2>{{ group.title }}</h2><dl class="metrics">@for (metric of group.items; track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> }</dl></section>
      }</div>
      @if (item.garminStrength; as strength) {
        <section class="card" aria-label="Garmin strength summary"><h2>Garmin strength sets</h2>
          <dl class="metrics"><div><dt>Working sets</dt><dd>{{ strength.workingSets }}</dd></div>
            <div><dt>Recorded set entries</dt><dd>{{ strength.totalRecordedSets }}</dd></div>
            <div><dt>Exercises with labels</dt><dd>{{ strength.exerciseCount }}</dd></div>
            <div><dt>Warm-up sets</dt><dd>{{ strength.warmupSets }}</dd></div>
            <div><dt>Rest markers</dt><dd>{{ strength.restMarkers }}</dd></div>
            <div><dt>Unknown sets</dt><dd>{{ strength.unknownSets }}</dd></div></dl>
          <p>Policy v{{ strength.policyVersion }} · source updated {{ strength.sourceUpdatedAt }}</p>
          @if (!strength.complete) { <p>Incomplete set classification. Existing workout points are preserved during recalculation.</p> }
          @for (exercise of strength.exercises; track exercise.name) { <p>{{ exercise.name }} · {{ exercise.workingSets }} working sets</p> }
        </section>
      }
      @if (item.notes && item.source !== 'strava') { <section class="card notes-card"><h2>Notes</h2><p class="notes">{{ item.notes }}</p></section> }
      <section class="card provider-detail" aria-label="Provider data">
        <h2>Provider data</h2>
        <p>Fetch downloads detail for this activity. View reads retained data. Canonical activity facts and scores stay unchanged.</p>
        @if (store.coverageError()) { <p role="alert">Could not check retained data. <button type="button" (click)="store.refreshCoverage()">Check again</button></p> }
        @else if (!store.coverage()) { <p role="status">Checking retained data…</p> }
        @if (item.providerDetail?.provider === 'strava') {
          <div class="provider-heading"><h3>Strava</h3><span class="badge">Summary present</span><span class="badge">{{ store.coverage()?.strava?.state === 'cached' ? 'Detail bundle retained' : store.coverage()?.strava?.state === 'stale' ? 'Detail needs refresh' : 'Full detail not fetched' }}</span></div>
          <div class="provider-actions">
            <button type="button" [disabled]="providerState() === 'loading' || !store.coverage()" (click)="store.strava(true)">{{ providerState() === 'loading' ? 'Loading Strava…' : 'Fetch Strava detail' }}</button>
            <button type="button" [disabled]="providerState() === 'loading' || store.coverage()?.strava?.state !== 'cached'" (click)="store.strava()">View Strava data</button>
            @if (store.coverage()?.strava?.state === 'cached' || store.coverage()?.strava?.state === 'stale') { <button type="button" [disabled]="providerState() === 'loading'" (click)="store.strava(true, true)">Refresh from Strava</button> }
          </div>
          @if (providerState() === 'loading') { <p role="status">Loading detailed activity, streams, laps and zones…</p> }
          @if (providerState() === 'error' || providerState() === 'missing') { <p role="alert">{{ store.providerError() }}</p> }
          @if (providerState() === 'loaded') {
            <p>Retained Strava data · {{ providerCacheStatus() === 'hit' ? 'cache hit' : 'fetched from Strava' }} · {{ providerFetchedAt() }}</p>
            <dl class="metrics">@for (metric of stravaMetrics(store.providerDetail()?.resources?.['detail']?.payload); track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> }</dl>
            <details class="provider-json"><summary>Strava detail, streams, laps and zones (advanced)</summary><pre>{{ providerJson() }}</pre></details>
          }
        }
        <div class="provider-heading"><h3>Garmin</h3><span class="badge">{{ store.coverage()?.garmin?.state === 'cached' ? 'Rich data retained' : store.coverage()?.garmin?.linked ? 'Linked · detail missing' : 'Not linked' }}</span></div>
        <div class="provider-actions">
          <button type="button" [disabled]="store.garminState() === 'loading' || !store.coverage() || (!store.coverage()?.garmin?.fetchEnabled && store.coverage()?.garmin?.state !== 'cached')" (click)="store.garminDetail(true)">{{ store.garminState() === 'loading' ? 'Loading Garmin…' : 'Fetch Garmin detail' }}</button>
          <button type="button" [disabled]="store.garminState() === 'loading' || store.coverage()?.garmin?.state !== 'cached'" (click)="store.garminDetail()">View Garmin data</button>
          @if (store.coverage()?.garmin?.linked && store.coverage()?.garmin?.fetchEnabled) { <button type="button" [disabled]="store.garminState() === 'loading'" (click)="store.garminDetail(true, true)">Refresh from Garmin</button> }
        </div>
        @if (store.coverage() && !store.coverage()?.garmin?.fetchEnabled) { <p>New Garmin downloads require the local desktop helper. Retained Garmin data can still be viewed.</p> }
        @if (store.garminState() === 'loading') { <p role="status">Checking retained data and fetching only if needed…</p> }
        @if (store.garminState() === 'error' || store.garminState() === 'missing') { <p role="alert">{{ store.garminError() }}</p> }
        @if (store.garminState() === 'loaded' && store.garminError()) { <p role="alert">{{ store.garminError() }}</p> }
        @if (store.garmin(); as garmin) {
          <p>Retained Garmin data · {{ garmin.retainedAt }} @if (garmin.cacheStatus) { · {{ garmin.cacheStatus === 'hit' ? 'cache hit' : 'fetched from Garmin' }} }</p>
          <h4>Garmin session and running dynamics</h4>
          <dl class="metrics">@for (metric of fitMetrics(garmin.sessions[0]); track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> } @empty { <p>No supported session metrics were provided.</p> }</dl>
          <details class="provider-json"><summary>Garmin laps ({{ garmin.laps.length }} shown, up to 100)</summary>
            @for (lap of garmin.laps; track $index) { <h4>Lap {{ $index + 1 }}</h4><dl class="metrics">@for (metric of fitMetrics(lap); track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> }</dl> }
          </details>
          <details class="provider-json"><summary>Garmin exercise sets</summary>
            @for (set of exerciseSetRows(garmin.sets); track $index) { <h4>Set {{ $index + 1 }}</h4><dl class="metrics">@for (field of set; track field.label) { <div><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div> }</dl> } @empty { <p>No exercise sets were provided.</p> }
            <details><summary>Exercise set JSON (advanced)</summary><pre>{{ setsJson() }}</pre></details>
          </details>
          <details class="provider-json"><summary>Garmin retained source records (advanced)</summary>
            <p>Read one retained resource at a time. These may include GPS and other private telemetry.</p>
            <label>Resource <select [value]="resourceIndex()" (change)="resourceIndex.set(+$any($event.target).value)">@for (resource of garmin.resources; track $index) { <option [value]="$index">{{ resource.resourceType }} · part {{ resource.chunkIndex + 1 }}</option> }</select></label>
            <button type="button" [disabled]="store.resourceState() === 'loading'" (click)="viewResource()">View retained resource</button>
            @if (store.resourceState() === 'loading') { <p role="status">Loading retained resource…</p> }
            @if (store.resourceState() === 'error' || store.resourceState() === 'missing') { <p role="alert">Could not read this resource. Try again.</p> }
            @if (store.resourceState() === 'loaded') { <pre>{{ store.resourceJson() }}</pre> }
          </details>
        }
      </section>
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
    .provider-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; }.provider-heading h3 { margin: 0 4px 0 0; }.badge { font-size: 12px; border-radius: 16px; padding: 4px 9px; background: #eef2ff; color: #344054; }.provider-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; } button:disabled { opacity: .55; cursor: default; } select { max-width: 100%; margin: 8px; }.metrics dt { text-transform: capitalize; }
    .breadcrumb { margin-bottom: 18px; color: #667085; }.breadcrumb a { color: #1d4ed8; }
    header { margin-bottom: 18px; } h1 { margin: 4px 0; } h1 small { font-size: 18px; font-weight: 500; color: #667085; }
    header p { margin: 0; color: #667085; text-transform: capitalize; }.source-name { margin-top: 10px; color: #344054; font-size: 16px; text-transform: none; }.page-kicker { color: #5368ae; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .metric-sections { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); }.metric-sections h2 { margin-top: 0; font-size: 17px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 18px; }
    dt { color: #667085; font-size: 12px; } dd { margin: 3px 0 0; font-weight: 700; overflow-wrap: anywhere; }
    .notes-card { margin-top: 12px; }.notes { white-space: pre-wrap; }.provider-detail { margin-top: 16px; }.provider-detail h2 { margin-top: 0; font-size: 17px; }.provider-detail p { color: #667085; }.provider-json summary { cursor: pointer; font-weight: 700; }.provider-json pre { max-height: 620px; overflow: auto; padding: 16px; border-radius: 8px; background: #101828; color: #f2f4f7; font-size: 12px; line-height: 1.5; white-space: pre; }.provenance { margin-top: 16px; }.provenance summary { cursor: pointer; font-weight: 700; }
    .provenance dl { display: grid; gap: 10px; }
    .source-json { margin-top: 12px; }.source-json summary { cursor: pointer; font-weight: 700; }
    .source-json p { color: #667085; }.source-json pre { max-height: 520px; overflow: auto; padding: 16px; border-radius: 8px; background: #101828; color: #f2f4f7; font-size: 12px; line-height: 1.5; white-space: pre; }
  `],
})
export class ActivityDetailPageComponent implements OnInit, OnDestroy {
  readonly metricGroups = metricGroups; readonly startTime = startTime; readonly subtypeLabel = subtypeLabel; readonly title = title;
  readonly exerciseSetRows = exerciseSetRows; readonly fitMetrics = fitMetrics; readonly stravaMetrics = stravaMetrics;
  readonly resourceIndex = signal(0);
  private id = ''; private routeSubscription?: Subscription;
  constructor(private readonly api: ActivitiesApiService, private readonly route: ActivatedRoute, readonly store: ActivityDetailStore = new ActivityDetailStore(api)) {}
  get state() { return this.store.state; } get activity() { return this.store.activity; }
  get sourceState() { return this.store.sourceState; } get sourceJson() { return this.store.sourceJson; }
  get providerState() { return this.store.providerState; } get providerJson() { return this.store.providerJson; }
  get providerFetchedAt() { return this.store.providerFetchedAt; } get providerCacheStatus() { return this.store.providerCacheStatus; }
  ngOnInit(): void { this.routeSubscription = this.route.paramMap.subscribe(params => { this.id = params.get('id') ?? ''; this.resourceIndex.set(0); this.load(); }); }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.store.ngOnDestroy(); }
  load(): void { this.store.load(this.id); }
  loadProviderDetail(): void { this.store.strava(true); }
  onSourceToggle(event: Event): void { if ((event.target as HTMLDetailsElement).open && this.sourceState() === 'idle') this.loadSourceJson(); }
  loadSourceJson(): void { this.store.source(); }
  setsJson(): string { return JSON.stringify(this.store.garmin()?.sets, null, 2) ?? 'null'; }
  viewResource(): void { const resource = this.store.garmin()?.resources[this.resourceIndex()]; if (resource) this.store.resource(resource.resourceType, resource.chunkIndex); }
}
