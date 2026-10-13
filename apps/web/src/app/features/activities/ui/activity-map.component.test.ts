// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityMapComponent, routeQuality } from './activity-map.component';
import { loadMapLibre } from './maplibre-loader';
import type { ActivityMapAvailable } from '../activities-api.service';

vi.mock('./maplibre-loader', () => ({ loadMapLibre: vi.fn() }));
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

const route: ActivityMapAvailable = {
  status: 'available', source: 'strava', resolution: 'summary',
  geometry: { type: 'LineString', coordinates: [[12, 55], [12.1, 55.2]] },
  bounds: [12, 55, 12.1, 55.2], pointCount: 2,
};
const maps: FakeMap[] = [];
const markers: FakeMarker[] = [];
class FakeMap {
  events = new Map<string, () => void>();
  on = vi.fn((event: string, listener: () => void) => { this.events.set(event, listener); return this; });
  addSource = vi.fn();
  addLayer = vi.fn();
  fitBounds = vi.fn();
  addControl = vi.fn();
  remove = vi.fn();
  constructor(readonly options: object) { maps.push(this); }
  emit(event: string) { this.events.get(event)?.(); }
}
class FakeMarker {
  setLngLat = vi.fn((_coordinates: [number,number]) => this);
  addTo = vi.fn((_map: FakeMap) => this);
  constructor(readonly options: object) { markers.push(this); }
}
beforeEach(() => {
  maps.length = 0; markers.length = 0;
  vi.mocked(loadMapLibre).mockReset().mockResolvedValue({
    Map: FakeMap as never, Marker: FakeMarker as never, NavigationControl: class {} as never,
  });
});
async function render(data: ActivityMapAvailable = route) {
  const fixture = TestBed.createComponent(ActivityMapComponent);
  Object.defineProperty(fixture.componentInstance, 'route', { value: signal(data) });
  Object.defineProperty(fixture.componentInstance, 'canvas', { value: () => ({ nativeElement: document.createElement('div') }) });
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}
describe('ActivityMapComponent', () => {
  it('draws the retained GeoJSON, fits viewport, shows markers/attribution, cleans up', async () => {
    const fixture = await render();
    expect(loadMapLibre).toHaveBeenCalledTimes(1);
    expect(maps).toHaveLength(1);
    expect((maps[0].options as {style: {sources: {osm: {attribution: string}}}}).style.sources.osm.attribution).toContain('OpenStreetMap');
    maps[0].emit('load'); fixture.detectChanges();
    expect(maps[0].addSource).toHaveBeenCalledWith('activity-route', expect.objectContaining({data: expect.objectContaining({geometry: route.geometry})}));
    expect(maps[0].addLayer).toHaveBeenCalledTimes(2);
    expect(maps[0].fitBounds).toHaveBeenCalledWith([[12,55],[12.1,55.2]], expect.objectContaining({maxZoom:15}));
    expect(markers).toHaveLength(2);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Strava · Summary route');
    fixture.destroy(); expect(maps[0].remove).toHaveBeenCalledTimes(1);
  });
  it('places a single marker for a loop and supports future Garmin provenance labels', async () => {
    const loop: ActivityMapAvailable = { ...route, source: 'garmin', resolution: 'fit',
      geometry: { type:'LineString', coordinates: [[12,55],[12.1,55.2],[12,55]] }, pointCount:3 };
    const fixture = await render(loop);
    maps[0].emit('load');
    expect(markers).toHaveLength(1);
    expect(routeQuality(loop)).toBe('Garmin · FIT route');
    fixture.destroy();
  });
  it('reports CDN load errors and retries without re-fetching provider data', async () => {
    vi.mocked(loadMapLibre).mockRejectedValueOnce(new Error('offline'));
    const fixture = await render();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Could not display the map');
    const retry = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    retry.click(); await fixture.whenStable(); fixture.detectChanges();
    expect(loadMapLibre).toHaveBeenCalledTimes(2);
    expect(maps).toHaveLength(1);
    fixture.destroy();
  });
  it('ignores late async creation after navigation/disposal', async () => {
    let resolve!: (value: never) => void;
    vi.mocked(loadMapLibre).mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const fixture = TestBed.createComponent(ActivityMapComponent);
    Object.defineProperty(fixture.componentInstance, 'route', { value: signal(route) });
    Object.defineProperty(fixture.componentInstance, 'canvas', { value: () => ({ nativeElement: document.createElement('div') }) });
    fixture.detectChanges();
    fixture.destroy();
    resolve({ Map: FakeMap, Marker: FakeMarker, NavigationControl: class {} } as never);
    await Promise.resolve();
    expect(maps).toHaveLength(0);
  });
});
