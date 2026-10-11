import '@angular/compiler';
import { of, Subject, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import { ActivityDetailStore } from './activity-detail.store';
const coverage = { strava: { state: 'cached' }, garmin: { state: 'cached', linked: true, fetchEnabled: true } };
function setup() {
  const api = { reprocessEfforts:vi.fn(()=>of({})), reprocessMetrics:vi.fn(()=>of({})), detail: vi.fn(() => of({ id: 'one', activity_type:'run', providerDetail: { provider: 'strava' }, provenance: { sourceRecordId: 'record' } })), enrichment: vi.fn(() => of(coverage)), providerDetail: vi.fn(() => of({ fetchedAt: '2026-01-01', cacheStatus: 'hit', resources: {} })), fetchProviderDetail: vi.fn(() => of({ fetchedAt: '2026-01-01', cacheStatus: 'miss', resources: {} })), garminDetail: vi.fn(() => of({ sessions: [], laps: [], sets: null, resources: [] })), fetchGarminDetail: vi.fn(() => of({ sessions: [], laps: [], sets: null, resources: [] })), sourceJson: vi.fn(), garminResource: vi.fn(() => of({ payload: [] })) };
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
