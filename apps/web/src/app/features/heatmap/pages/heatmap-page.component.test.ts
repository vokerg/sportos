// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { HeatmapPageComponent } from './heatmap-page.component';
import { HeatmapApiService } from '../data-access/heatmap-api.service';
import { loadMapLibre } from '../../../shared/util/maplibre-loader';
import type { HeatmapPage } from '../model/heatmap.models';

vi.mock('../../../shared/util/maplibre-loader', () => ({loadMapLibre: vi.fn()}));
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

class FakeMap {
  events = new Map<string, () => void>();
  addSource = vi.fn();
  addLayer = vi.fn();
  addControl = vi.fn();
  fitBounds = vi.fn();
  remove = vi.fn();
  on = vi.fn((name: string, callback: () => void) => { this.events.set(name, callback); return this; });
  constructor(readonly options: object) { maps.push(this); }
  emit(name: string) { this.events.get(name)?.(); }
}
const maps: FakeMap[] = [];
const result = (count = 1): HeatmapPage => ({
  limit:50, hasMore:false, nextCursor:null, partial: false,
  coverage:{eligibleScanned:count,usable:count,missingGps:0,invalidGeometry:0,budgetExceeded:0,
    quality:{summary:count,streams:0,detail:0,fit:0}},
  items: Array.from({length:count}, (_,i) => ({
    activityId:'activity-'+i, date:'2026-05-01', sport:'run' as const,
    source:'strava' as const, resolution:'summary',
    geometry:{type:'LineString' as const, coordinates:[[12,55],[12.0002,55]] as [number,number][]},
  })),
});
let api: { list: ReturnType<typeof vi.fn> };
beforeEach(() => {
  maps.length = 0;
  api = {list: vi.fn().mockReturnValue(of(result()))};
  vi.mocked(loadMapLibre).mockReset().mockResolvedValue({
    Map: FakeMap as never, Marker: class {} as never, NavigationControl: class {} as never,
  });
  TestBed.configureTestingModule({providers: [
    provideRouter([]), {provide:HeatmapApiService,useValue:api},
  ]});
});
async function settle(fixture: ReturnType<typeof TestBed.createComponent<HeatmapPageComponent>>) {
  // A viewReady signal set in ngAfterViewInit schedules the component effect
  // for the next change-detection pass. Let its asynchronous MapLibre load settle.
  for (let pass = 0; pass < 3; pass++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();
  }
}
async function render() {
  const fixture = TestBed.createComponent(HeatmapPageComponent);
  // Align with activity-map.component.test.ts: Angular's JIT TestBed does not
  // reliably resolve signal viewChild queries before this mocked MapLibre path.
  Object.defineProperty(fixture.componentInstance, 'canvas', {
    value: () => ({nativeElement: document.createElement('div')}),
  });
  await settle(fixture);
  return fixture;
}
describe('HeatmapPageComponent', () => {
  it('uses all time/all sports, private GeoJSON density layers, fitBounds and cleanup', async () => {
    const fixture = await render();
    expect(api.list).toHaveBeenCalledWith({}, undefined);
    expect(fixture.componentInstance.store.state()).toBe('ready');
    expect(fixture.componentInstance.store.dataset()?.routes).toBe(1);
    expect(vi.mocked(loadMapLibre)).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.mapError()).toBe(false);
    expect(maps).toHaveLength(1);
    expect((maps[0]!.options as { center: [number, number] }).center).toEqual([12.0001, 55]);
    maps[0]!.emit('load'); fixture.detectChanges();
    expect(maps[0]!.addSource).toHaveBeenCalledWith('sportos-heatmap', expect.objectContaining({type:'geojson'}));
    expect(maps[0]!.addLayer).toHaveBeenCalledTimes(8);
    expect(maps[0]!.fitBounds).toHaveBeenCalledWith([[12,55],[12.0002,55]], expect.objectContaining({maxZoom:14}));
    expect(fixture.nativeElement.textContent).toContain('Strava summary (approximate)');
    expect(fixture.nativeElement.querySelector('select').value).toBe('all');
    fixture.destroy();
    expect(maps[0]!.remove).toHaveBeenCalledTimes(1);
  });
  it('refreshes filters without provider requests and tears down superseded maps', async () => {
    const fixture = await render();
    maps[0]!.emit('load'); fixture.detectChanges();
    fixture.componentInstance.setSport('bike');
    await settle(fixture);
    expect(api.list).toHaveBeenLastCalledWith({activityType:'bike'},undefined);
    expect(maps[0]!.remove).toHaveBeenCalledTimes(1);
    expect(maps).toHaveLength(2);
    fixture.componentInstance.setRange('1m');
    await settle(fixture);
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({activityType:'bike',from:expect.any(String),to:expect.any(String)}),undefined);
    fixture.destroy();
    expect(maps.at(-1)!.remove).toHaveBeenCalled();
  });
  it('shows errors/retry and never renders partial or failed route feeds', async () => {
    const first = new Subject<HeatmapPage>();
    api.list.mockReset().mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(of(result()));
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('Loading private routes');
    expect(maps).toHaveLength(0);
    first.error(new Error('offline'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing partial is displayed');
    fixture.componentInstance.store.retry();
    await settle(fixture);
    expect(maps).toHaveLength(1);
    fixture.destroy();
  });
  it('offers retry when MapLibre cannot load without requesting routes again', async () => {
    vi.mocked(loadMapLibre).mockRejectedValueOnce(new Error('map CDN unavailable'));
    const fixture = await render();
    expect(fixture.componentInstance.mapError()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('The map could not be displayed');
    expect(maps).toHaveLength(0);
    const retry = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    retry.find(button => button.textContent?.includes('Retry map'))?.click();
    await settle(fixture);
    expect(loadMapLibre).toHaveBeenCalledTimes(2);
    expect(maps).toHaveLength(1);
    expect(api.list).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(maps[0]!.remove).toHaveBeenCalledTimes(1);
  });
  it('does not create maps for no-GPS archives and cancels pending requests on teardown', async () => {
    api.list.mockReturnValueOnce(of({ ...result(0), coverage:{eligibleScanned:2,usable:0,missingGps:2,invalidGeometry:0,budgetExceeded:0,
      quality:{summary:0,streams:0,detail:0,fit:0}} }));
    const empty = await render();
    expect(empty.nativeElement.textContent).toContain('No usable GPS routes');
    expect(maps).toHaveLength(0);
    empty.destroy();

    const pending = new Subject<HeatmapPage>();
    api.list.mockReturnValueOnce(pending.asObservable());
    const loading = await render();
    expect(pending.observed).toBe(true);
    loading.destroy();
    expect(pending.observed).toBe(false);
  });
});
