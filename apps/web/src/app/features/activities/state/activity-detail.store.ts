import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ActivitiesApiService, type ActivityDetail, type ActivityMapAvailable, type ActivityMapResponse, type ActivityProviderDetailResponse, type EnrichmentStatus, type GarminDetail } from '../activities-api.service';
type LoadState = 'idle' | 'loading' | 'loaded' | 'missing' | 'error';

@Injectable()
export class ActivityDetailStore implements OnDestroy {
  readonly mapState = signal<'idle' | 'loading' | 'available' | 'unavailable' | 'error'>('idle');
  readonly mapData = signal<ActivityMapAvailable | null>(null);
  readonly mapReason = signal<string | null>(null);
  readonly effortState=signal<LoadState>('idle'); readonly effortError=signal('');
  readonly metricState=signal<LoadState>('idle'); readonly metricError=signal('');
  readonly state = signal<LoadState>('loading'); readonly activity = signal<ActivityDetail | null>(null);
  readonly coverage = signal<EnrichmentStatus | null>(null); readonly coverageError = signal(false);
  readonly sourceState = signal<LoadState>('idle'); readonly sourceJson = signal<string | null>(null);
  readonly providerState = signal<LoadState>('idle'); readonly providerDetail = signal<ActivityProviderDetailResponse | null>(null);
  readonly providerJson = signal<string | null>(null); readonly providerFetchedAt = signal<string | null>(null); readonly providerCacheStatus = signal<'hit' | 'miss' | null>(null);
  readonly providerError = signal('');
  readonly garminState = signal<LoadState>('idle'); readonly garmin = signal<GarminDetail | null>(null); readonly garminError = signal('');
  readonly resourceState = signal<LoadState>('idle'); readonly resourceJson = signal<string | null>(null);
  private requests = new Map<string, Subscription>(); private id = ''; private generation = 0;
  constructor(private readonly api: ActivitiesApiService) {}
  ngOnDestroy() { this.cancel(); }
  private cancel() { this.generation++; for (const request of this.requests.values()) request.unsubscribe(); this.requests.clear(); }
  load(id: string, options: { coverage?: boolean } = {}) {
    this.cancel(); this.id = id; this.state.set('loading'); this.effortState.set('idle'); this.effortError.set(''); this.metricState.set('idle');this.metricError.set(''); this.activity.set(null); this.mapState.set('idle'); this.mapData.set(null); this.mapReason.set(null); this.coverage.set(null); this.coverageError.set(false);
    this.sourceState.set('idle'); this.sourceJson.set(null); this.providerState.set('idle'); this.providerDetail.set(null); this.providerJson.set(null); this.providerFetchedAt.set(null); this.providerCacheStatus.set(null); this.providerError.set('');
    this.garminState.set('idle'); this.garmin.set(null); this.garminError.set(''); this.resourceState.set('idle'); this.resourceJson.set(null);
    const generation = this.generation;
    this.requests.set('activity', this.api.detail(id).subscribe({ next: activity => { if (generation !== this.generation) return; this.activity.set(activity); this.state.set('loaded'); if (options.coverage !== false) this.refreshCoverage(); this.loadMap(); }, error: error => { if (generation === this.generation) this.state.set(missing(error)); } }));
  }
  loadMap() {
    if (!this.activity()) return;
    this.requests.get('map')?.unsubscribe();
    this.mapState.set('loading'); this.mapData.set(null); this.mapReason.set(null);
    const generation = this.generation;
    this.requests.set('map', this.api.map(this.id).subscribe({
      next: (response: ActivityMapResponse) => {
        if (generation !== this.generation) return;
        if (response.status === 'available') {
          this.mapData.set(response);
          this.mapState.set('available');
        } else {
          this.mapReason.set(response.reason);
          this.mapState.set('unavailable');
        }
      },
      error: () => { if (generation === this.generation) this.mapState.set('error'); },
    }));
  }
  refreshCoverage() {
    this.requests.get('coverage')?.unsubscribe(); const generation = this.generation;
    this.requests.set('coverage', this.api.enrichment(this.id).subscribe({ next: status => { if (generation === this.generation) { this.coverage.set(status); this.coverageError.set(false); } }, error: () => { if (generation === this.generation) this.coverageError.set(true); } }));
  }
  strava(fetch = false, refresh = false) {
    if (this.providerState() === 'loading' || !this.activity()?.providerDetail) return;
    this.providerState.set('loading'); this.providerError.set(''); const generation = this.generation;
    const request = fetch ? this.api.fetchProviderDetail(this.id, refresh) : this.api.providerDetail(this.id);
    this.requests.set('strava', request.subscribe({ next: detail => { if (generation !== this.generation) return; this.providerDetail.set(detail); this.providerJson.set(JSON.stringify(detail.resources, null, 2)); this.providerFetchedAt.set(new Date(detail.fetchedAt).toLocaleString()); this.providerCacheStatus.set(detail.cacheStatus); this.providerState.set('loaded'); this.refreshCoverage(); if(fetch) { this.refreshActivity(); this.loadMap(); } }, error: error => { if (generation === this.generation) { this.providerState.set(missing(error)); this.providerError.set(message(error, 'Could not load Strava detail. You can retry or reconnect Strava.')); if(fetch) this.refreshActivity(); } } }));
  }
  garminDetail(fetch = false, refresh = false) {
    if (this.garminState() === 'loading') return;
    this.garminState.set('loading'); this.garminError.set(''); const generation = this.generation;
    const request = fetch ? this.api.fetchGarminDetail(this.id, refresh) : this.api.garminDetail(this.id);
    this.requests.set('garmin', request.subscribe({ next: detail => { if (generation !== this.generation) return; this.garmin.set(detail); this.garminState.set('loaded'); this.refreshCoverage(); if (fetch) { this.refreshActivity(); this.loadMap(); } }, error: error => { if (generation === this.generation) { this.garminState.set(missing(error)); this.garminError.set(message(error, 'Could not load Garmin detail. Retry after checking your local login.')); if(fetch) this.refreshActivity(); } } }));
  }
  reprocessEfforts() {
    if(this.effortState()==='loading' || this.activity()?.activity_type!=='run') return;
    this.effortState.set('loading'); this.effortError.set(''); const generation=this.generation;
    this.requests.set('efforts',this.api.reprocessEfforts(this.id).subscribe({next:()=>{if(generation!==this.generation)return;this.effortState.set('loaded');this.refreshActivity();},error:()=>{if(generation===this.generation){this.effortState.set('error');this.effortError.set('Could not calculate retained efforts. Evidence is safe; try again.');this.refreshActivity();}}}));
  }
  reprocessMetrics() {
    if(this.metricState()==='loading') return;
    this.metricState.set('loading');this.metricError.set(''); const generation=this.generation;
    this.requests.set('metrics',this.api.reprocessMetrics(this.id).subscribe({next:()=>{if(generation!==this.generation)return;this.metricState.set('loaded');this.refreshActivity();},error:()=>{if(generation===this.generation){this.metricState.set('error');this.metricError.set('Could not normalize retained metrics. Evidence is safe; try again.');this.refreshActivity();}}}));
  }
  private refreshActivity() {
    this.requests.get('activity')?.unsubscribe(); const generation = this.generation;
    this.requests.set('activity', this.api.detail(this.id).subscribe({ next: activity => {
      if (generation === this.generation) this.activity.set(activity);
    }, error: () => { if (generation === this.generation) this.metricError.set('Retained data is safe, but the activity metrics could not refresh. Reload the activity to view them.'); } }));
  }
  resource(type: string, chunk: number) {
    this.requests.get('resource')?.unsubscribe(); this.resourceState.set('loading'); this.resourceJson.set(null); const generation = this.generation;
    this.requests.set('resource', this.api.garminResource(this.id, type, chunk).subscribe({ next: data => { if (generation === this.generation) { this.resourceJson.set(JSON.stringify(data.payload, null, 2)); this.resourceState.set('loaded'); } }, error: error => { if (generation === this.generation) this.resourceState.set(missing(error)); } }));
  }
  source() {
    if (!this.activity()?.provenance.sourceRecordId || this.sourceState() === 'loading') return;
    this.sourceState.set('loading'); const generation = this.generation;
    this.requests.set('source', this.api.sourceJson(this.id).subscribe({ next: data => { if (generation === this.generation) { this.sourceJson.set(JSON.stringify(data.rawJson, null, 2)); this.sourceState.set('loaded'); } }, error: error => { if (generation === this.generation) this.sourceState.set(missing(error)); } }));
  }
}
function missing(error: unknown): LoadState { return error instanceof HttpErrorResponse && error.status === 404 ? 'missing' : 'error'; }
function message(error: unknown, fallback: string) { return error instanceof HttpErrorResponse && typeof error.error?.message === 'string' ? error.error.message.slice(0, 300) : fallback; }
