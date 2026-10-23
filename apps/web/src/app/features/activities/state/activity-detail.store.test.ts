import '@angular/compiler';
import { of, Subject, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import { ActivityDetailStore } from './activity-detail.store';
const coverage = { strava: { state: 'cached' }, garmin: { state: 'cached', linked: true, fetchEnabled: true } };
function setup() {
  const api = { timeline: vi.fn(() => of({source:'strava',status:'available',metrics:[],durationS:1,sampleCount:2,simplified:false})), map: vi.fn(() => of({status: 'unavailable', reason: 'no_gps'})), reprocessEfforts:vi.fn(()=>of({})), reprocessMetrics:vi.fn(()=>of({})), detail: vi.fn(() => of({ id: 'one', activity_type:'run', providerDetail: { provider: 'strava' }, provenance: { sourceRecordId: 'record' } })), enrichment: vi.fn(() => of(coverage)), providerDetail: vi.fn(() => of({ fetchedAt: '2026-01-01', cacheStatus: 'hit', resources: {} })), fetchProviderDetail: vi.fn(() => of({ fetchedAt: '2026-01-01', cacheStatus: 'miss', resources: {} })), garminDetail: vi.fn(() => of({ sessions: [], laps: [], sets: null, resources: [] })), fetchGarminDetail: vi.fn(() => of({ sessions: [], laps: [], sets: null, resources: [] })), sourceJson: vi.fn(), garminResource: vi.fn(() => of({ payload: [] })) };
  return { api, store: new ActivityDetailStore(api as never) };
}
describe('ActivityDetailStore', () => {
  it('navigation reads only canonical data and availability even when both rich caches exist', () => {
    const { api, store } = setup(); store.load('one');
    expect(api.enrichment).toHaveBeenCalledWith('one');
    for (const method of [api.providerDetail, api.fetchProviderDetail, api.garminDetail, api.fetchGarminDetail, api.sourceJson]) expect(method).not.toHaveBeenCalled();
    expect(store.providerState()).toBe('idle'); expect(store.garminState()).toBe('idle');
  });
  it('distinguishes cached reads, explicit downloads and explicit refreshes for both providers', () => {
    const { api, store } = setup(); store.load('one'); store.strava(); store.strava(true, true); store.garminDetail(); store.garminDetail(true, true);
    expect(api.providerDetail).toHaveBeenCalledWith('one'); expect(api.fetchProviderDetail).toHaveBeenCalledWith('one', true);
    expect(api.garminDetail).toHaveBeenCalledWith('one'); expect(api.fetchGarminDetail).toHaveBeenCalledWith('one', true);
    expect(api.garminResource).not.toHaveBeenCalled(); store.resource('records', 2); expect(api.garminResource).toHaveBeenCalledWith('one','records',2);
  });
  it('prevents repeat clicks and cancels stale requests on navigation and teardown', () => {
    const { api, store } = setup(); const pending = new Subject<never>(); api.fetchGarminDetail.mockReturnValue(pending as never);
    store.load('one'); store.garminDetail(true); store.garminDetail(true); expect(api.fetchGarminDetail).toHaveBeenCalledTimes(1);
    store.load('two'); pending.next({ sessions: [] } as never); expect(store.garmin()).toBeNull(); expect(store.garminState()).toBe('idle'); expect(pending.observed).toBe(false);
    store.garminDetail(true); store.ngOnDestroy(); expect(pending.observed).toBe(false);
  });
  it('keeps ambiguity, reauthentication and rate-limit failures visible and retryable', () => {
    const { api, store } = setup(); api.fetchGarminDetail.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'GARMIN_MATCH_AMBIGUOUS', message: 'Multiple Garmin candidates require review.' } })));
    store.load('one'); store.garminDetail(true); expect(store.garminError()).toContain('require review'); expect(store.garminState()).toBe('error'); store.garminDetail(true); expect(api.fetchGarminDetail).toHaveBeenCalledTimes(2);
  });
});

it('refreshes compact strength after explicit Fetch and cancels a stale refresh on navigation',()=>{
  const {api,store}=setup();store.load('one');
  const refresh=new Subject<never>();api.detail.mockReturnValueOnce(refresh as never);
  store.garminDetail(true);expect(api.detail).toHaveBeenCalledTimes(2);
  refresh.next({id:'one',garminStrength:{workingSets:6}} as never);
  expect(store.activity()?.garminStrength?.workingSets).toBe(6);
  store.load('two');refresh.next({id:'one',garminStrength:{workingSets:9}} as never);
  expect(store.activity()?.garminStrength).toBeUndefined();expect(refresh.observed).toBe(false);
});

 it('normalizes retained data only on explicit intent and refreshes the comparison without downloading',()=>{
   const {api,store}=setup();store.load('one');expect(api.reprocessMetrics).not.toHaveBeenCalled();
   store.reprocessMetrics();expect(api.reprocessMetrics).toHaveBeenCalledWith('one');expect(api.detail).toHaveBeenCalledTimes(2);
   expect(api.fetchProviderDetail).not.toHaveBeenCalled();expect(api.fetchGarminDetail).not.toHaveBeenCalled();
 });
 it('cancels retained normalization on navigation and prevents repeated clicks',()=>{
   const {api,store}=setup();const pending=new Subject<never>();api.reprocessMetrics.mockReturnValue(pending as never);
   store.load('one');store.reprocessMetrics();store.reprocessMetrics();expect(api.reprocessMetrics).toHaveBeenCalledTimes(1);
   store.load('two');expect(pending.observed).toBe(false);expect(store.metricState()).toBe('idle');
 });

it('calculates retained efforts only on intent, refreshes primary results and cancels repeated/stale work',()=>{
 const {api,store}=setup();store.load('one');expect(api.reprocessEfforts).not.toHaveBeenCalled();
 store.reprocessEfforts();expect(api.reprocessEfforts).toHaveBeenCalledWith('one');expect(api.detail).toHaveBeenCalledTimes(2);
 expect(api.fetchProviderDetail).not.toHaveBeenCalled();expect(api.fetchGarminDetail).not.toHaveBeenCalled();
 const pending=new Subject<never>();api.reprocessEfforts.mockReturnValue(pending as never);
 store.reprocessEfforts();store.reprocessEfforts();expect(api.reprocessEfforts).toHaveBeenCalledTimes(2);
 store.load('two');expect(pending.observed).toBe(false);expect(store.effortState()).toBe('idle');
});
it('refreshes stale effort status after a failed explicit fetch but not a retained read failure',()=>{
 const {api,store}=setup();api.fetchProviderDetail.mockReturnValue(throwError(()=>new HttpErrorResponse({status:503})));
 store.load('one');store.strava(true);expect(api.detail).toHaveBeenCalledTimes(2);
 api.providerDetail.mockReturnValue(throwError(()=>new HttpErrorResponse({status:404})));store.strava();expect(api.detail).toHaveBeenCalledTimes(2);
});

describe('activity map state', () => {
  it('reads a map only after canonical detail and never downloads rich resources', () => {
    const { api, store } = setup();
    store.load('first');
    expect(api.map).toHaveBeenCalledWith('first');
    expect(store.mapState()).toBe('unavailable');
    expect(store.mapReason()).toBe('no_gps');
    expect(api.providerDetail).not.toHaveBeenCalled();
    expect(api.fetchProviderDetail).not.toHaveBeenCalled();
    expect(api.fetchGarminDetail).not.toHaveBeenCalled();
    store.ngOnDestroy();
  });
  it('never requests a GPS map for indoor pool swims but preserves it for outdoor swims',()=>{
    const {api,store}=setup();
    api.detail.mockReturnValueOnce(of({id:'pool',activity_type:'swim',subtype:'indoor'}));
    store.load('pool');expect(api.map).not.toHaveBeenCalled();
    api.detail.mockReturnValueOnce(of({id:'open',activity_type:'swim',subtype:'outdoor'}));
    store.load('open');expect(api.map).toHaveBeenCalledWith('open');
    store.ngOnDestroy();
  });
  it('renders available route data and resets it on navigation to an indoor activity', () => {
    const { api, store } = setup();
    api.map.mockReturnValueOnce(of({ status: 'available', source: 'strava', resolution: 'summary',
      geometry: {type:'LineString', coordinates:[[12,55],[12.1,55.2]]}, bounds:[12,55,12.1,55.2], pointCount:2 }) as never);
    store.load('outdoor');
    expect(store.mapState()).toBe('available');
    expect(store.mapData()?.geometry.coordinates[0]).toEqual([12,55]);
    store.load('indoor');
    expect(store.mapState()).toBe('unavailable');
    expect(store.mapData()).toBeNull();
    store.ngOnDestroy();
  });
  it('cancels stale map requests when switching IDs or destroying the page', () => {
    const { api, store } = setup();
    const pending = new Subject<never>();
    api.map.mockReturnValueOnce(pending as never);
    store.load('old');
    expect(pending.observed).toBe(true);
    store.load('new');
    expect(pending.observed).toBe(false);
    pending.next({ status: 'available' } as never);
    expect(store.mapState()).toBe('unavailable');
    api.map.mockReturnValueOnce(pending as never);
    store.loadMap(); expect(pending.observed).toBe(true);
    store.ngOnDestroy(); expect(pending.observed).toBe(false);
  });
  it('shows route errors and retries without refreshing the activity or providers', () => {
    const { api, store } = setup();
    api.map.mockReturnValueOnce(throwError(() => new HttpErrorResponse({status:503})));
    store.load('first');
    expect(store.mapState()).toBe('error');
    store.loadMap();
    expect(store.mapState()).toBe('unavailable');
    expect(api.detail).toHaveBeenCalledTimes(1);
    expect(api.map).toHaveBeenCalledTimes(2);
    store.ngOnDestroy();
  });
});

describe('pool lengths read workflow',()=>{
  it('only reads retained splits after intent, cancels stale requests and never fetches providers',()=>{
    const {api,store}=setup();
    api.swimLengths=vi.fn(()=>of({status:'available',lengths:[]}));
    api.detail.mockReturnValueOnce(of({id:'pool',activity_type:'swim',subtype:'indoor',garmin:{provider:'garmin'}}));
    store.load('pool');
    expect(api.swimLengths).not.toHaveBeenCalled();
    store.loadSwimLengths();expect(store.swimLengthState()).toBe('loaded');
    expect(api.swimLengths).toHaveBeenCalledWith('pool');
    expect(api.fetchGarminDetail).not.toHaveBeenCalled();
    const pending=new Subject<never>();api.swimLengths.mockReturnValueOnce(pending as never);
    store.loadSwimLengths();expect(pending.observed).toBe(true);
    store.load('other');expect(pending.observed).toBe(false);expect(store.swimLengths()).toBeNull();
    store.loadSwimLengths();expect(api.swimLengths).toHaveBeenCalledTimes(2);
  });
});
describe('activity timeline workflow', () => {
  it('reads rich telemetry only on graph intent, keeping downloads separate', () => {
    const {api,store}=setup();store.load('one');expect(api.timeline).not.toHaveBeenCalled();
    store.loadTimeline('strava');expect(api.timeline).toHaveBeenCalledWith('one','strava');expect(store.timelineState()).toBe('loaded');
    expect(api.fetchProviderDetail).not.toHaveBeenCalled();expect(api.fetchGarminDetail).not.toHaveBeenCalled();
  });
  it('cancels old source requests, prevents repeated clicks, and clears data on activity changes', () => {
    const {api,store}=setup();const pending=new Subject<never>();api.timeline.mockReturnValueOnce(pending as never);
    store.load('one');store.loadTimeline('strava');store.loadTimeline('strava');expect(api.timeline).toHaveBeenCalledTimes(1);
    store.loadTimeline('garmin');expect(pending.observed).toBe(false);expect(store.timelineSource()).toBe('garmin');
    store.load('two');expect(store.timelineData()).toBeNull();expect(store.timelineState()).toBe('idle');
    api.timeline.mockReturnValueOnce(pending as never);store.loadTimeline('garmin');store.ngOnDestroy();expect(pending.observed).toBe(false);
  });
  it('clears the previous source on a failed switch and supports retry', () => {
    const {api,store}=setup();store.load('one');store.loadTimeline('strava');
    api.timeline.mockReturnValueOnce(throwError(()=>new Error('offline')));store.loadTimeline('garmin');
    expect(store.timelineState()).toBe('error');expect(store.timelineData()).toBeNull();
    store.loadTimeline('garmin');expect(store.timelineState()).toBe('loaded');
  });
});
