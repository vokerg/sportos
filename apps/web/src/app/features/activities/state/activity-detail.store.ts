import {pollDurableJob} from '../../../core/jobs/durable-job-poller';
import {activeGarminJob,terminalGarminJob,garminJobMessage,type GarminFetchJob} from '../../../shared/model/garmin-job';
import { runLaps, type LapSource } from '../model/run-laps.models';
import type { ActivityTimeline, TimelineSource } from '../model/activity-timeline.models';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { Subscription,of } from 'rxjs';
import { ActivitiesApiService, type ActivityDetail, type ActivityMapAvailable, type ActivityMapResponse, type ActivityProviderDetailResponse, type EnrichmentStatus, type GarminDetail, type SwimLengthResponse } from '../activities-api.service';
type LoadState = 'idle' | 'loading' | 'loaded' | 'missing' | 'error';

@Injectable()
export class ActivityDetailStore implements OnDestroy {
  readonly runLapSource = signal<LapSource>('strava');
  readonly runLapState = computed(() => this.runLapSource() === 'strava'
    ? this.activity() && !this.activity()?.providerDetail ? 'missing' : this.providerState()
    : this.garminState());
  readonly runLapData = computed(() => runLaps(this.runLapSource(), this.providerDetail(), this.garmin()));
  loadRunLaps(source: LapSource = this.runLapSource()) {
    if (this.activity()?.activity_type !== 'run') return;
    this.runLapSource.set(source);
    if (source === 'strava') this.strava(); else this.garminDetail();
  }
  readonly timelineState = signal<'idle'|'loading'|'loaded'|'error'>('idle');
  readonly timelineSource = signal<TimelineSource>('strava');
  readonly timelineData = signal<ActivityTimeline|null>(null);
  private timelineRequest = 0;
  readonly swimLengthState = signal<'idle'|'loading'|'loaded'|'error'>('idle');
  readonly swimLengths = signal<SwimLengthResponse|null>(null);
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
  readonly garminJob=signal<GarminFetchJob|null>(null); readonly garminJobMessage=signal('');
  readonly garminState = signal<LoadState>('idle'); readonly garmin = signal<GarminDetail | null>(null); readonly garminError = signal('');
  readonly resourceState = signal<LoadState>('idle'); readonly resourceJson = signal<string | null>(null);
  readonly distanceCorrectionState = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly distanceCorrectionError = signal('');
  private requests = new Map<string, Subscription>(); private id = ''; private generation = 0;
  constructor(private readonly api: ActivitiesApiService) {}
  ngOnDestroy() { this.cancel(); }
  private cancel() { this.generation++; for (const request of this.requests.values()) request.unsubscribe(); this.requests.clear(); }
  load(id: string, options: { coverage?: boolean } = {}) {
    this.cancel(); this.runLapSource.set('strava'); this.swimLengthState.set('idle'); this.swimLengths.set(null); this.timelineRequest++; this.timelineState.set('idle'); this.timelineData.set(null); this.timelineSource.set('strava'); this.id = id; this.state.set('loading'); this.effortState.set('idle'); this.effortError.set(''); this.metricState.set('idle');this.metricError.set(''); this.activity.set(null); this.mapState.set('idle'); this.mapData.set(null); this.mapReason.set(null); this.coverage.set(null); this.coverageError.set(false); this.distanceCorrectionState.set('idle'); this.distanceCorrectionError.set('');
    this.sourceState.set('idle'); this.sourceJson.set(null); this.providerState.set('idle'); this.providerDetail.set(null); this.providerJson.set(null); this.providerFetchedAt.set(null); this.providerCacheStatus.set(null); this.providerError.set('');
    this.garminJob.set(null);this.garminJobMessage.set('');this.garminState.set('idle'); this.garmin.set(null); this.garminError.set(''); this.resourceState.set('idle'); this.resourceJson.set(null);
    const generation = this.generation;
    this.requests.set('activity', this.api.detail(id).subscribe({ next: activity => { if (generation !== this.generation) return; this.activity.set(activity); if (activity.activity_type === 'swim' && activity.garmin) this.timelineSource.set('garmin'); this.state.set('loaded'); if (options.coverage !== false) this.refreshCoverage(); if (activity.activity_type === 'swim' && activity.subtype === 'indoor') { this.mapState.set('unavailable'); this.mapReason.set('indoor_pool_swim'); } else this.loadMap(); }, error: error => { if (generation === this.generation) this.state.set(missing(error)); } }));
  }
  loadTimeline(source: TimelineSource = this.timelineSource()) {
    if (!this.activity() || (this.timelineState() === 'loading' && source === this.timelineSource())) return;
    this.requests.get('timeline')?.unsubscribe();
    this.timelineSource.set(source); this.timelineData.set(null); this.timelineState.set('loading');
    const generation = this.generation, request = ++this.timelineRequest;
    this.requests.set('timeline', this.api.timeline(this.id, source).subscribe({
      next: data => { if (generation === this.generation && request === this.timelineRequest) { this.timelineData.set(data); this.timelineState.set('loaded'); } },
      error: () => { if (generation === this.generation && request === this.timelineRequest) this.timelineState.set('error'); },
    }));
  }
  loadSwimLengths() {
    const activity = this.activity();
    if (!activity || activity.activity_type !== 'swim' || activity.subtype === 'outdoor' || this.swimLengthState() === 'loading') return;
    this.swimLengthState.set('loading'); this.swimLengths.set(null);
    const generation = this.generation;
    this.requests.get('swimLengths')?.unsubscribe();
    this.requests.set('swimLengths', this.api.swimLengths(this.id).subscribe({
      next: data => { if (generation === this.generation) { this.swimLengths.set(data); this.swimLengthState.set('loaded'); } },
      error: () => { if (generation === this.generation) this.swimLengthState.set('error'); },
    }));
  }
  loadMap() {
    if (!this.activity() || (this.activity()!.activity_type === 'swim' && this.activity()!.subtype === 'indoor')) return;
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
    this.requests.set('coverage', this.api.enrichment(this.id).subscribe({ next: status => { if (generation === this.generation) { this.coverage.set(status); this.coverageError.set(false);if(status.garmin?.activeJob&&!this.garminJob()){this.garminJob.set(status.garmin.activeJob);this.checkGarminJob();} } }, error: () => { if (generation === this.generation) this.coverageError.set(true); } }));
  }
  strava(fetch = false, refresh = false) {
    if (this.providerState() === 'loading' || !this.activity()?.providerDetail) return;
    this.providerState.set('loading'); this.providerError.set(''); const generation = this.generation;
    const request = fetch ? this.api.fetchProviderDetail(this.id, refresh) : this.api.providerDetail(this.id);
    this.requests.set('strava', request.subscribe({ next: detail => { if (generation !== this.generation) return; this.providerDetail.set(detail); this.providerJson.set(JSON.stringify(detail.resources, null, 2)); this.providerFetchedAt.set(new Date(detail.fetchedAt).toLocaleString()); this.providerCacheStatus.set(detail.cacheStatus); this.providerState.set('loaded'); this.refreshCoverage(); if(fetch) { this.refreshActivity(); this.loadMap(); } }, error: error => { if (generation === this.generation) { this.providerState.set(missing(error)); this.providerError.set(message(error, 'Could not load Strava detail. You can retry or reconnect Strava.')); if(fetch) this.refreshActivity(); } } }));
  }
  garminDetail(fetch = false, refresh = false) {
    if(this.garminState()==='loading')return;
    if(fetch){
      if(activeGarminJob(this.garminJob())){this.checkGarminJob();return;}
      if(!this.coverage()?.garmin.fetchEnabled)return;
      this.garminState.set('loading');this.garminError.set('');const generation=this.generation;
      this.requests.set('garmin',this.api.fetchGarminDetail(this.id,refresh).subscribe({next:job=>{if(generation===this.generation){if(job.operation!=='activity'||job.activityId!==this.id){this.garminState.set('error');this.garminError.set('Unexpected Garmin job response.');return;}this.garminJob.set(job);this.checkGarminJob()}},error:error=>{if(generation===this.generation){this.garminState.set('error');this.garminError.set(message(error,'Could not queue Garmin. Refresh coverage before retrying.'))}}}));return;
    }
    this.garminState.set('loading');this.garminError.set('');const generation=this.generation;
    this.requests.set('garmin',this.api.garminDetail(this.id).subscribe({next:detail=>{if(generation===this.generation){this.garmin.set(detail);this.garminState.set('loaded')}},error:error=>{if(generation===this.generation){this.garminState.set(missing(error));this.garminError.set(message(error,'Could not read retained Garmin detail.'))}}}));
  }
  checkGarminJob(){
    const current=this.garminJob();if(!current)return;
    this.requests.get('garminPoll')?.unsubscribe();this.garminState.set('loading');const generation=this.generation;
    this.requests.set('garminPoll',(terminalGarminJob(current)?of({state:'terminal' as const,attempt:0,job:current}):pollDurableJob(()=>this.api.garminJob(current.id),{intervalMs:5000,maxAttempts:120,maxDurationMs:600000,isTerminal:terminalGarminJob})).subscribe(event=>{
      if(generation!==this.generation)return;
      if(event.job){if(event.job.id!==current.id||event.job.operation!=='activity'||event.job.activityId!==this.id){this.garminState.set('error');this.garminError.set('Unexpected Garmin job response.');this.requests.get('garminPoll')?.unsubscribe();return;}this.garminJob.set(event.job);this.garminJobMessage.set(garminJobMessage(event.job));}
      if(event.state==='terminal'){
        this.garminState.set('idle');this.refreshCoverage();
        if(event.job.status==='succeeded'){this.garminDetail();this.invalidateGarminCharts();this.refreshActivity();this.loadMap();}
        else{this.garminState.set('error');this.garminError.set(garminJobMessage(event.job));}
      }else if(event.state==='exhausted'||event.state==='error'){this.garminState.set('error');this.garminError.set('Status checks paused. The job continues; check Garmin status to resume.');}
    }));
  }
  cancelGarminJob(){const job=this.garminJob();if(!job)return;const generation=this.generation;this.requests.set('garminCancel',this.api.cancelGarminJob(job.id).subscribe({next:result=>{if(generation===this.generation){this.garminJob.set(result);this.checkGarminJob()}},error:()=>{if(generation===this.generation)this.garminError.set('Cancellation could not be requested. Check status.')}}))}
  retryGarminJob(){const job=this.garminJob();if(!job||activeGarminJob(job)||!this.coverage()?.garmin.fetchEnabled)return;const generation=this.generation;this.garminState.set('loading');this.requests.set('garminRetry',this.api.retryGarminJob(job.id).subscribe({next:result=>{if(generation===this.generation){this.garminJob.set(result);this.checkGarminJob()}},error:()=>{if(generation===this.generation){this.garminState.set('error');this.garminError.set('Could not retry Garmin. Refresh coverage.')}}}))}
  private invalidateGarminCharts() {
    // A successful Fetch/Refresh may publish a new immutable source version.
    // Cancel older reads, then require explicit chart reloads from that version.
    this.requests.get('swimLengths')?.unsubscribe();
    this.swimLengths.set(null); this.swimLengthState.set('idle');
    if (this.timelineSource() === 'garmin') {
      this.requests.get('timeline')?.unsubscribe(); this.timelineRequest++;
      this.timelineData.set(null); this.timelineState.set('idle');
    }
  }
  reprocessEfforts() {
    if(this.effortState()==='loading' || this.activity()?.activity_type!=='run') return;
    this.effortState.set('loading'); this.effortError.set(''); const generation=this.generation;
    this.requests.set('efforts',this.api.reprocessEfforts(this.id).subscribe({next:()=>{if(generation!==this.generation)return;this.effortState.set('loaded');this.refreshActivity();},error:()=>{if(generation===this.generation){this.effortState.set('error');this.effortError.set('Could not calculate retained efforts. Evidence is safe; try again.');this.refreshActivity();}}}));
  }
  reprocessMetrics() {
    if(this.metricState()==='loading') return;
    this.metricState.set('loading');this.metricError.set(''); const generation=this.generation;
    this.requests.set('metrics',this.api.reprocessMetrics(this.id).subscribe({next:()=>{if(generation!==this.generation)return;this.metricState.set('loaded');this.refreshActivity();},error:()=>{if(generation===this.generation){this.metricState.set('error');this.metricError.set('Could not rebuild derived metrics. Evidence is safe; try again.');this.refreshActivity();}}}));
  }
  private refreshActivity() {
    this.requests.get('activity')?.unsubscribe(); const generation = this.generation;
    this.requests.set('activity', this.api.detail(this.id).subscribe({ next: activity => {
      if (generation === this.generation) this.activity.set(activity);
    }, error: () => { if (generation === this.generation) this.metricError.set('Retained data is safe, but the activity metrics could not refresh. Reload the activity to view them.'); } }));
  }
  clearDistanceCorrectionState() { this.distanceCorrectionState.set('idle'); this.distanceCorrectionError.set(''); }
  saveDistanceCorrection(effectiveDistanceM: number, reason: string) {
    const activity = this.activity();
    if (!activity || activity.activity_type !== 'swim' || activity.subtype !== 'indoor' || this.distanceCorrectionState() === 'saving') return;
    this.distanceCorrectionState.set('saving'); this.distanceCorrectionError.set('');
    const generation = this.generation;
    this.requests.get('distanceCorrection')?.unsubscribe();
    this.requests.set('distanceCorrection', this.api.saveDistanceCorrection(this.id, effectiveDistanceM, reason, activity.distanceCorrection?.revision ?? null).subscribe({
      next: () => { if (generation !== this.generation) return; this.distanceCorrectionState.set('saved'); this.invalidateCorrectedSwimViews(); this.refreshActivity(); },
      error: error => { if (generation !== this.generation) return; this.distanceCorrectionState.set('error'); this.distanceCorrectionError.set(message(error, 'Could not save the distance correction. Reload and try again.')); },
    }));
  }
  resetDistanceCorrection() {
    const activity = this.activity();
    if (!activity || activity.activity_type !== 'swim' || activity.subtype !== 'indoor' || this.distanceCorrectionState() === 'saving') return;
    this.distanceCorrectionState.set('saving'); this.distanceCorrectionError.set('');
    const generation = this.generation;
    this.requests.get('distanceCorrection')?.unsubscribe();
    this.requests.set('distanceCorrection', this.api.resetDistanceCorrection(this.id, activity.distanceCorrection?.revision ?? null).subscribe({
      next: () => { if (generation !== this.generation) return; this.distanceCorrectionState.set('saved'); this.invalidateCorrectedSwimViews(); this.refreshActivity(); },
      error: error => { if (generation !== this.generation) return; this.distanceCorrectionState.set('error'); this.distanceCorrectionError.set(message(error, 'Could not reset the distance correction. Reload and try again.')); },
    }));
  }
  private invalidateCorrectedSwimViews() {
    this.requests.get('swimLengths')?.unsubscribe();
    this.swimLengths.set(null); this.swimLengthState.set('idle');
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
