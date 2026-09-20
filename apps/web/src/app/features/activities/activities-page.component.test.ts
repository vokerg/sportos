import '@angular/compiler';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ActivitiesPageComponent } from './activities-page.component';
import { ActivityDetailPageComponent } from './activity-detail-page.component';
import { ActivitiesStore } from './activities.store';
import type { ActivitiesApiService, ActivitiesResponse } from './activities-api.service';
import { quickRangeDates } from './activity.view-model';

const empty: ActivitiesResponse = { items: [], summary: { count: 0, durationS: 0, distanceM: 0 }, limit: 50, offset: 0 };

describe('Activities pages', () => {
  it('defaults to Strava and the shared three-month quick range, with an empty result state', () => {
    const params = new BehaviorSubject(convertToParamMap({}));
    const api = { list: vi.fn().mockReturnValue(of(empty)) };
    const store = new ActivitiesStore(api as unknown as ActivitiesApiService);
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const page = new ActivitiesPageComponent(store, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    expect(store.state()).toBe('loading');
    page.ngOnInit();
    expect(page.source()).toBe('strava');
    expect(page.quickRange()).toBe('3m');
    expect(api.list).toHaveBeenCalledWith({ ...quickRangeDates('3m'), source: 'strava', limit: 50, offset: 0 });
    expect(store.state()).toBe('loaded');
    expect(store.result()?.items).toEqual([]);

    page.setQuickRange('all');
    expect(router.navigate).toHaveBeenCalledWith(['/activities'], { queryParams: expect.objectContaining({ range: 'all', from: null, to: null, source: 'strava' }) });
    params.next(convertToParamMap({ range: 'all', source: 'all' }));
    expect(api.list).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });
    page.ngOnDestroy();
  });

  it('sends only the selected sport filters and clears them when the sport changes', () => {
    const params = new BehaviorSubject(convertToParamMap({ range: 'all', activityType: 'run', source: 'strava', paceUnderSPerKm: '252', minDistanceM: '5000' }));
    const api = { list: vi.fn().mockReturnValue(of(empty)) };
    const store = new ActivitiesStore(api as unknown as ActivitiesApiService);
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const page = new ActivitiesPageComponent(store, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    page.ngOnInit();
    expect(api.list).toHaveBeenCalledWith({ activityType: 'run', source: 'strava', minDistanceM: 5000, paceUnderSPerKm: 252, limit: 50, offset: 0 });
    page.setActivityType('bike'); page.minSpeedKmh.set(25);
    expect(page.paceUnderSPerKm()).toBe(0);
    page.apply({ preventDefault: vi.fn() } as unknown as Event);
    expect(router.navigate).toHaveBeenCalledWith(['/activities'], { queryParams: expect.objectContaining({ activityType: 'bike', paceUnderSPerKm: null, minSpeedKmh: 25 }) });
    params.next(convertToParamMap({ range: 'all', activityType: 'bike', source: 'strava', minSpeedKmh: '25' }));
    expect(api.list).toHaveBeenLastCalledWith({ activityType: 'bike', source: 'strava', minAvgSpeedMps: 25 / 3.6, limit: 50, offset: 0 });
    params.next(convertToParamMap({ range: 'all', activityType: 'swim', source: 'strava', swimPaceUnderSPer100m: '120' }));
    expect(api.list).toHaveBeenLastCalledWith({ activityType: 'swim', source: 'strava', swimPaceUnderSPer100m: 120, limit: 50, offset: 0 });
    page.ngOnDestroy();
  });

  it('surfaces list errors and renders detail API state', () => {
    const store = new ActivitiesStore({ list: () => throwError(() => Error('offline')) } as never);
    const list = new ActivitiesPageComponent(store,
      { queryParamMap: new BehaviorSubject(convertToParamMap({})) } as never, { navigate: vi.fn() } as never);
    list.ngOnInit(); expect(store.state()).toBe('error'); list.ngOnDestroy();
    const detail = new ActivityDetailPageComponent({ detail: () => of({ id: 'abc', activity_type: 'swim' }) } as never,
      { paramMap: new BehaviorSubject(convertToParamMap({ id: 'abc' })) } as never);
    detail.ngOnInit(); expect(detail.activity()).toMatchObject({ id: 'abc', activity_type: 'swim' });
    expect(detail.state()).toBe('loaded'); detail.ngOnDestroy();
  });

  it('loads full provider detail on demand when an activity has a Strava link', () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'strava-activity' }));
    const providerDetail = vi.fn().mockReturnValue(of({
      provider: 'strava',
      providerActivityId: '20223486250',
      fetchedAt: '2026-09-20T10:00:00Z',
      cacheStatus: 'miss',
      resources: {
        detail: { availability: 'available', httpStatus: 200, payload: { id: 20223486250 } },
        streams: { availability: 'available', httpStatus: 200, payload: { heartrate: { data: [130, 132] } } },
        laps: { availability: 'available', httpStatus: 200, payload: [] },
        zones: { availability: 'unavailable', httpStatus: 403, payload: null },
      },
    }));
    const detail = vi.fn().mockReturnValue(of({
      id: 'strava-activity',
      activity_type: 'run',
      providerDetail: { provider: 'strava', providerActivityId: '20223486250' },
      provenance: { sourceRecordId: 'record', sourceRecordSource: 'strava_api' },
    }));
    const page = new ActivityDetailPageComponent({ detail, providerDetail } as unknown as ActivitiesApiService,
      { paramMap: params } as unknown as ActivatedRoute);
    page.ngOnInit();
    expect(providerDetail).toHaveBeenCalledWith('strava-activity');
    expect(page.providerState()).toBe('loaded');
    expect(page.providerCacheStatus()).toBe('miss');
    expect(page.providerJson()).toContain('heartrate');
    page.ngOnDestroy();
  });

  it('discards a stale response when filters change during loading', () => {
    const first = new Subject<ActivitiesResponse>();
    const api = { list: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(of(empty)) };
    const store = new ActivitiesStore(api as unknown as ActivitiesApiService);
    store.load({ source: 'strava', limit: 50, offset: 0 });
    expect(store.state()).toBe('loading');
    store.load({ source: 'garmin', limit: 50, offset: 0 });
    first.next({ ...empty, summary: { ...empty.summary, count: 99 } });
    expect(store.result()?.summary.count).toBe(0);
    store.destroy();
  });

  it('loads retained source JSON only when expanded and resets it for another activity', () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'first' }));
    const sourceJson = vi.fn().mockReturnValue(of({ sourceRecordId: 'record', sourceRecordSource: 'strava_api', rawJson: { average_cadence: 88 } }));
    const detail = vi.fn().mockImplementation((id: string) => of({ id, activity_type: 'run', provenance: { sourceRecordId: 'record', sourceRecordSource: 'strava_api' } }));
    const page = new ActivityDetailPageComponent({ detail, sourceJson } as unknown as ActivitiesApiService,
      { paramMap: params } as unknown as ActivatedRoute);
    page.ngOnInit();
    expect(sourceJson).not.toHaveBeenCalled();
    page.onSourceToggle({ target: { open: true } } as unknown as Event);
    expect(sourceJson).toHaveBeenCalledWith('first');
    expect(page.sourceJson()).toBe('{\n  "average_cadence": 88\n}');
    page.onSourceToggle({ target: { open: true } } as unknown as Event);
    expect(sourceJson).toHaveBeenCalledTimes(1);
    params.next(convertToParamMap({ id: 'second' }));
    expect(page.sourceState()).toBe('idle');
    expect(page.sourceJson()).toBeNull();
    page.ngOnDestroy();
  });
});
