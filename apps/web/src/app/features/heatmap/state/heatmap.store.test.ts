import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { HeatmapStore } from './heatmap.store';
import type { HeatmapApiService } from '../data-access/heatmap-api.service';
import type { HeatmapPage, HeatmapRoute } from '../model/heatmap.models';

const track = (id: string): HeatmapRoute => ({
  activityId: id, date: '2026-01-02', sport: 'run', source: 'strava', resolution: 'summary',
  geometry: { type: 'LineString', coordinates: [[12,55],[12.0001,55]] },
});
const page = (items: HeatmapRoute[], hasMore = false, nextCursor: string|null = null, missing = 0): HeatmapPage => ({
  items, hasMore, nextCursor, limit:50, partial:hasMore || missing>0,
  coverage: {eligibleScanned:items.length+missing,usable:items.length,missingGps:missing,invalidGeometry:0,budgetExceeded:0},
});
let fetch!: ReturnType<typeof vi.fn>;
let store!: HeatmapStore;
beforeEach(() => {
  fetch = vi.fn();
  store = new HeatmapStore({list: fetch} as unknown as HeatmapApiService);
});
describe('HeatmapStore', () => {
  it('loads every page before exposing geometry and starts with unbounded all-time filters', () => {
    const second = new Subject<HeatmapPage>();
    fetch.mockReturnValueOnce(of(page([track('a')],true,'next',1))).mockReturnValueOnce(second.asObservable());
    store.load({});
    expect(fetch).toHaveBeenNthCalledWith(1,{},undefined);
    expect(fetch).toHaveBeenNthCalledWith(2,{},'next');
    expect(store.state()).toBe('loading');
    expect(store.dataset()).toBeNull();
    expect(store.coverage()).toMatchObject({eligibleScanned:2,usable:1,missingGps:1});
    second.next(page([track('b')]));
    second.complete();
    expect(store.state()).toBe('ready');
    expect(store.dataset()?.routes).toBe(2);
    expect(store.coverage()).toEqual({eligibleScanned:3,usable:2,missingGps:1,invalidGeometry:0,budgetExceeded:0});
    expect(store.pagesLoaded()).toBe(2);
  });
  it('unsubscribes stale pages when filters change and ignores a late response', () => {
    const first = new Subject<HeatmapPage>();
    fetch.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(of(page([track('fresh')])));
    store.load({});
    expect(first.observed).toBe(true);
    store.load({activityType:'run'});
    expect(first.observed).toBe(false);
    first.next(page([track('stale')]));
    expect(store.dataset()?.routes).toBe(1);
    expect(fetch).toHaveBeenLastCalledWith({activityType:'run'},undefined);
    store.ngOnDestroy();
    expect(store.dataset()).toBeNull();
  });
  it('does not show partially loaded routes if any page fails; retry starts from first cursor', () => {
    fetch.mockReturnValueOnce(of(page([track('a')],true,'next')))
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValueOnce(of(page([track('a')])));
    store.load({});
    expect(store.state()).toBe('error');
    expect(store.dataset()).toBeNull();
    expect(store.error()).toContain('Nothing partial');
    store.retry();
    expect(store.state()).toBe('ready');
    expect(fetch).toHaveBeenNthCalledWith(3,{},undefined);
  });
  it('reports empty datasets with missing GPS without pretending every activity has a route', () => {
    fetch.mockReturnValue(of(page([],false,null,4)));
    store.load({});
    expect(store.state()).toBe('empty');
    expect(store.dataset()?.routes).toBe(0);
    expect(store.coverage().eligibleScanned).toBe(4);
  });
  it('rejects cursor loops, invalid pagination, and impossible browser budgets', () => {
    fetch.mockReturnValueOnce(of(page([track('a')],true,'loop')))
      .mockReturnValueOnce(of(page([track('b')],true,'loop')));
    store.load({});
    expect(store.state()).toBe('error');
    expect(store.dataset()).toBeNull();
    store.clear();
    expect(store.state()).toBe('idle');
    expect(store.coverage().eligibleScanned).toBe(0);
    fetch.mockReset().mockReturnValue(of(page(Array.from({length:50}, (_,i) => track(String(i))),true,'same')));
    store.load({});
    expect(store.state()).toBe('error');
  });
});
