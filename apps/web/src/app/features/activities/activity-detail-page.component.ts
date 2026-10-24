import { ActivityTimelineComponent } from './ui/activity-timeline.component';
import { SwimLengthsComponent } from './ui/swim-lengths.component';
import { ActivityMapComponent } from './ui/activity-map.component';
import { RunningEffortsComponent } from './ui/running-efforts.component';
import { ActivityMetricProvenanceComponent } from './ui/activity-metric-provenance.component';
import { ProviderMetricStatusComponent } from './ui/provider-metric-status.component';
import { ActivityMetricComparisonComponent } from './ui/activity-metric-comparison.component';
import { ActivityTypeIconComponent } from '../../shared/ui/activity-type-icon.component';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivitiesApiService } from './activities-api.service';
import { ActivityDetailStore } from './state/activity-detail.store';
import { exerciseSetRows, fitMetrics, stravaMetrics } from './provider-detail.view-model';
import { startTime, title, displayedSubtype } from './activity.view-model';

@Component({
  selector: 'sportos-activity-detail-page', standalone: true, imports: [RouterLink, ActivityTimelineComponent, SwimLengthsComponent, ActivityMapComponent, RunningEffortsComponent, ProviderMetricStatusComponent, ActivityMetricComparisonComponent, ActivityMetricProvenanceComponent, ActivityTypeIconComponent], providers: [ActivityDetailStore],
  template: `
    <nav class="breadcrumb"><a routerLink="/activities">Activities</a> › Activity</nav>
    @if (state() === 'loading') { <section class="card" role="status">Loading activity…</section> }
    @else if (state() === 'error') { <section class="card" role="alert">Could not load this activity. <button type="button" (click)="load()">Try again</button></section> }
    @else if (state() === 'missing') { <section class="card">Activity not found.</section> }
    @else { @if (activity(); as item) {
      <sportos-activity-metric-comparison [metrics]="item.metricComparisons ?? []" [sport]="item.activity_type" [activity]="item" presentation="summary">
      <header><h1><sportos-activity-type-icon [activityType]="item.activity_type" [attr.data-sport]="item.activity_type" />{{ title(item) }} @if (displayedSubtype(item)) { <small [attr.title]="item.runClassification ? 'Run type from Garmin' : null">· {{ displayedSubtype(item) }}</small> }</h1><p>{{ item.activity_date }} @if (startTime(item.start_time)) { · {{ startTime(item.start_time) }} } · {{ item.source.replaceAll('_', ' ') }}</p>
        @if (item.source === 'strava' && item.notes) { <p class="source-name">{{ item.notes }}</p> }
      </header>
      </sportos-activity-metric-comparison>
      @if (item.historicalSummary) { <p class="card">Historical Excel reconstruction: a daily run summary. The number of sessions, device, start time and GPS route are unknown. A historical time is shown only when an exact full-distance record supports it; its pause basis is unspecified.</p> }
      @if (item.activity_type === 'walk') { <p>Retained in activity history. This walk does not contribute activity points; walking steps remain in the all-day step total.</p> }
      @if (item.activity_type !== 'swim' || item.subtype !== 'indoor') {
      @if (store.mapState() === 'loading') { <section class="card map-status" role="status">Loading activity route…</section> }
      @else if (store.mapState() === 'available' && store.mapData()) {
        <sportos-activity-map [route]="store.mapData()!" [activityId]="item.id" />
      }
      @else if (store.mapState() === 'unavailable') {
        <section class="card map-status" aria-label="Activity route unavailable">
          <p>{{ store.mapReason() === 'indoor_pool_swim' ? 'Indoor pool swims do not have a GPS route.' : store.mapReason() === 'invalid_geometry' ? 'The retained GPS route is invalid.' : store.mapReason() === 'summary_polyline_missing' ? 'No Strava summary GPS route was retained for this activity.' : 'No GPS route is available for this activity.' }}</p>
        </section>
      }
      @else if (store.mapState() === 'error') { <section class="card map-status" role="alert">Could not load the GPS route. <button type="button" (click)="store.loadMap()">Try again</button></section> }
      }
      @if (item.activity_type === 'swim' && item.subtype !== 'outdoor') {
        <sportos-swim-lengths
          [state]="store.swimLengthState()"
          [data]="store.swimLengths()"
          [timelineState]="store.timelineState()"
          [timelineSource]="store.timelineSource()"
          [timelineData]="store.timelineData()"
          (load)="store.loadSwimLengths()"
          (timelineLoad)="store.loadTimeline($event)"
        />
      } @else {
        <sportos-activity-timeline [sport]="item.activity_type" [source]="store.timelineSource()" [state]="store.timelineState()" [data]="store.timelineData()" (load)="store.loadTimeline($event)" />
      }
      <sportos-activity-metric-comparison [metrics]="item.metricComparisons ?? []" [sport]="item.activity_type" [activity]="item" presentation="details" />
      @if (item.activity_type === 'swim' && item.subtype === 'indoor') {
        <section class="card distance-correction" aria-label="Swim distance correction">
          <div class="correction-heading"><h2>Distance correction</h2>@if (item.distanceCorrection) { <span class="badge">Manual correction</span> }</div>
          <p class="correction-summary"><strong>{{ formatDistance(item.distance_m) }}</strong> effective distance</p>
          @if (item.distanceCorrection; as correction) {
            <p class="muted">Recorded {{ correction.recordedSource.replaceAll('_', ' ') }} distance: {{ formatDistance(correction.recordedDistanceM) }} · {{ correction.reason }}</p>
          } @else { <p class="muted">Recorded provider distance. Individual lengths and rest periods remain unchanged.</p> }
          @if (editingDistance() && store.distanceCorrectionState() !== 'saved') {
            <form class="correction-form" (submit)="saveDistanceEdit($event)">
              <label>Effective distance (m)<input inputmode="decimal" type="number" min="0.01" max="1000000" step="0.01" [value]="distanceDraft()" (input)="distanceDraft.set($any($event.target).value)" /></label>
              <label>Reason<input type="text" maxlength="500" [value]="distanceReason()" (input)="distanceReason.set($any($event.target).value)" /></label>
              @if (distanceFormError()) { <p class="form-error" role="alert">{{ distanceFormError() }}</p> }
              <div class="provider-actions"><button type="submit" [disabled]="store.distanceCorrectionState() === 'saving'">{{ store.distanceCorrectionState() === 'saving' ? 'Saving…' : 'Save distance' }}</button><button type="button" [disabled]="store.distanceCorrectionState() === 'saving'" (click)="cancelDistanceEdit()">Cancel</button></div>
            </form>
          } @else {
            <div class="provider-actions"><button type="button" (click)="beginDistanceEdit(item)">Edit distance</button>@if (item.distanceCorrection) { <button type="button" [disabled]="store.distanceCorrectionState() === 'saving'" (click)="resetDistanceEdit()">{{ store.distanceCorrectionState() === 'saving' ? 'Resetting…' : 'Reset to recorded' }}</button> }</div>
          }
          @if (store.distanceCorrectionState() === 'error') { <p class="form-error" role="alert">{{ store.distanceCorrectionError() }}</p> }
          @if (store.distanceCorrectionState() === 'saved') { <p class="save-status" role="status">Distance correction saved. Daily scoring was updated only if this date was calculated.</p> }
        </section>
      }
      @if (item.activity_type === 'run') { <sportos-running-efforts [data]="item.bestEfforts ?? null" [loading]="store.effortState() === 'loading'" [error]="store.effortError()" (reprocess)="store.reprocessEfforts()" /> }
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
        <sportos-provider-metric-status [statuses]="item.providerMetrics ?? []" [expanded]="true" />
        @if (item.providerDetail || item.garmin) {
          <button type="button" [disabled]="store.metricState() === 'loading'" (click)="store.reprocessMetrics()">{{ store.metricState() === 'loading' ? 'Rebuilding derived metrics…' : 'Rebuild derived metrics' }}</button>
          <p>This replays already-retained FIT/Strava detail into comparison metrics. It does not contact a provider or change canonical distance, raw records, or scores.</p>
        }
        @if (store.metricError()) { <p role="alert">{{ store.metricError() }}</p> }
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
          <h4>{{ item.activity_type === 'swim' ? 'Garmin swim session' : 'Garmin session and running dynamics' }}</h4>
          <dl class="metrics">@for (metric of fitMetrics(garmin.sessions[0], item.activity_type); track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> } @empty { <p>No supported session metrics were provided.</p> }</dl>
          <details class="provider-json"><summary>Garmin laps ({{ garmin.laps.length }} shown, up to 100)</summary>
            @for (lap of garmin.laps; track $index) { <h4>Lap {{ $index + 1 }}</h4><dl class="metrics">@for (metric of fitMetrics(lap, item.activity_type); track metric.label) { <div><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div> }</dl> }
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
      </dl><sportos-activity-metric-provenance [metrics]="item.metricComparisons ?? []" /></details>
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
    .map-status{margin:16px 0;padding:12px 18px;color:var(--text-muted)}.map-status p{margin:0}.map-status button{margin-left:8px}
    .provider-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; }.provider-heading h3 { margin: 0 4px 0 0; }.badge { font-size: 12px; border-radius: 16px; padding: 4px 9px; background: var(--accent-surface); color: var(--text-secondary); }.provider-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; } button:disabled { opacity: .55; cursor: default; } select { max-width: 100%; margin: 8px; }.metrics dt { text-transform: capitalize; }
    .breadcrumb { margin-bottom: 18px; color: var(--text-muted); }.breadcrumb a { color: var(--link); }
    header { margin-bottom: 18px; } h1 { display:flex; align-items:center; gap:10px; margin: 4px 0; } h1 sportos-activity-type-icon { --activity-icon-size: 30px; } h1 sportos-activity-type-icon[data-sport=bike] { --activity-icon-color: var(--sport-bike); } h1 sportos-activity-type-icon[data-sport=swim] { --activity-icon-color: var(--sport-swim); } h1 small { font-size: 18px; font-weight: 500; color: var(--text-muted); }
    header p { margin: 0; color: var(--text-muted); text-transform: capitalize; }.source-name { margin-top: 10px; color: var(--text-secondary); font-size: 16px; text-transform: none; }.page-kicker { color: var(--link); font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 18px; }
    dt { color: var(--text-muted); font-size: 12px; } dd { margin: 3px 0 0; font-weight: 700; overflow-wrap: anywhere; }
    .notes-card { margin-top: 12px; }.notes { white-space: pre-wrap; }.provider-detail { margin-top: 16px; }.provider-detail h2 { margin-top: 0; font-size: 17px; }.provider-detail p { color: var(--text-muted); }.provider-json summary { cursor: pointer; font-weight: 700; }.provider-json pre { max-height: 620px; overflow: auto; padding: 16px; border-radius: 8px; background: var(--code-background); color: var(--code-text); font-size: 12px; line-height: 1.5; white-space: pre; }.provenance { margin-top: 16px; }.provenance summary { cursor: pointer; font-weight: 700; }
    .provenance dl { display: grid; gap: 10px; }
    .source-json { margin-top: 12px; }.source-json summary { cursor: pointer; font-weight: 700; }
    .source-json p { color: var(--text-muted); }.source-json pre { max-height: 520px; overflow: auto; padding: 16px; border-radius: 8px; background: var(--code-background); color: var(--code-text); font-size: 12px; line-height: 1.5; white-space: pre; }
    .distance-correction { margin-top: 16px; }.correction-heading { display: flex; align-items: center; gap: 8px; }.correction-heading h2 { margin: 0; font-size: 17px; }.correction-summary { font-size: 18px; margin-bottom: 4px; }.distance-correction .muted { color: var(--text-muted); }.correction-form { display: grid; gap: 12px; max-width: 460px; margin-top: 12px; }.correction-form label { display: grid; gap: 5px; color: var(--text-secondary); font-size: 13px; }.correction-form input { min-height: 36px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: inherit; font: inherit; }.form-error { color: var(--danger, #b42318); }.save-status { color: var(--text-secondary); }
  `],
})
export class ActivityDetailPageComponent implements OnInit, OnDestroy {
  readonly startTime = startTime;
  readonly displayedSubtype = displayedSubtype; readonly title = title;
  readonly exerciseSetRows = exerciseSetRows; readonly fitMetrics = fitMetrics; readonly stravaMetrics = stravaMetrics;
  readonly resourceIndex = signal(0);
  readonly editingDistance = signal(false);
  readonly distanceDraft = signal('');
  readonly distanceReason = signal('');
  readonly distanceFormError = signal('');
  private id = ''; private routeSubscription?: Subscription;
  constructor(private readonly api: ActivitiesApiService, private readonly route: ActivatedRoute, readonly store: ActivityDetailStore = new ActivityDetailStore(api)) {}
  get state() { return this.store.state; } get activity() { return this.store.activity; }
  get sourceState() { return this.store.sourceState; } get sourceJson() { return this.store.sourceJson; }
  get providerState() { return this.store.providerState; } get providerJson() { return this.store.providerJson; }
  get providerFetchedAt() { return this.store.providerFetchedAt; } get providerCacheStatus() { return this.store.providerCacheStatus; }
  ngOnInit(): void { this.routeSubscription = this.route.paramMap.subscribe(params => { this.id = params.get('id') ?? ''; this.resourceIndex.set(0); this.load(); }); }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.store.ngOnDestroy(); }
  load(): void { this.editingDistance.set(false); this.distanceFormError.set(''); this.store.load(this.id); }
  beginDistanceEdit(item: { distance_m: number | null; distanceCorrection?: { reason: string } | null }): void {
    this.editingDistance.set(true); this.distanceDraft.set(item.distance_m === null ? '' : String(item.distance_m));
    this.distanceReason.set(item.distanceCorrection?.reason ?? ''); this.distanceFormError.set(''); this.store.clearDistanceCorrectionState();
  }
  cancelDistanceEdit(): void { this.editingDistance.set(false); this.distanceFormError.set(''); this.store.clearDistanceCorrectionState(); }
  saveDistanceEdit(event: Event): void {
    event.preventDefault();
    const value = Number(this.distanceDraft());
    const reason = this.distanceReason().trim();
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
      this.distanceFormError.set('Enter a positive distance with at most two decimal places.'); return;
    }
    if (!reason || reason.length > 500) { this.distanceFormError.set('Enter a reason between 1 and 500 characters.'); return; }
    this.distanceFormError.set(''); this.store.saveDistanceCorrection(value, reason);
  }
  resetDistanceEdit(): void { this.editingDistance.set(false); this.distanceFormError.set(''); this.store.resetDistanceCorrection(); }
  formatDistance(value: number | null): string { return value === null || !Number.isFinite(value) ? 'Unavailable' : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} m`; }
  loadProviderDetail(): void { this.store.strava(true); }
  onSourceToggle(event: Event): void { if ((event.target as HTMLDetailsElement).open && this.sourceState() === 'idle') this.loadSourceJson(); }
  loadSourceJson(): void { this.store.source(); }
  setsJson(): string { return JSON.stringify(this.store.garmin()?.sets, null, 2) ?? 'null'; }
  viewResource(): void { const resource = this.store.garmin()?.resources[this.resourceIndex()]; if (resource) this.store.resource(resource.resourceType, resource.chunkIndex); }
}
