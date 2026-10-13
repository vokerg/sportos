import { AfterViewInit, Component, ElementRef, OnDestroy, computed, input, signal, viewChild } from '@angular/core';
import type { ActivityMapAvailable } from '../activities-api.service';
import { loadMapLibre, type MapInstance, type Coordinates } from './maplibre-loader';

const RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#eef2f5' } },
    { id: 'osm', type: 'raster', source: 'osm' },
  ],
};

export function routeQuality(route: Pick<ActivityMapAvailable, 'source' | 'resolution'>): string {
  const source = route.source === 'garmin' ? 'Garmin' : 'Strava';
  const resolution = ({
    summary: 'Summary route',
    streams: 'GPS streams',
    stream: 'GPS streams',
    detail: 'Detailed route',
    fit: 'FIT route',
  } as Record<string, string>)[route.resolution] ?? route.resolution.replace(/_/g, ' ') + ' route';
  return source + ' · ' + resolution;
}

@Component({
  selector: 'sportos-activity-map',
  standalone: true,
  template: `
    <section class="card activity-route" aria-label="Activity GPS route">
      <div class="heading"><h2>Route</h2><span class="quality">{{ quality() }}</span></div>
      <p class="description">{{ route().pointCount }} GPS points · Interactive map with pan and zoom. Map tiles © OpenStreetMap contributors.</p>
      <div #mapCanvas class="map" role="region" tabindex="0" [attr.aria-label]="quality()"></div>
      @if (loading()) { <p role="status">Preparing map…</p> }
      @if (failure()) { <p role="alert">Could not display the map. The route data is still available. <button type="button" (click)="retry()">Retry map</button></p> }
      @if (tilesFailed()) { <p role="status">Map tiles may be unavailable. Your recorded route remains unchanged.</p> }
      <p class="text-route">GPS route from {{ quality() }}, {{ route().pointCount }} points. Start and end markers are shown when they differ. Route geometry is based on retained provider GPS evidence.</p>
    </section>
  `,
  styles: [`
    :host{display:block;margin:16px 0}.activity-route{overflow:hidden}.heading{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:6px}
    h2{font-size:17px;margin:0}.quality{font-size:12px;border-radius:16px;background:#eef2ff;color:#344054;padding:5px 10px;font-weight:650}
    .description,.text-route{font-size:13px;color:#667085}.description{margin:4px 0 12px}
    .map{width:100%;height:clamp(260px,40vw,440px);border-radius:12px;background:#eef2f5;overflow:hidden}
    .map:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}.text-route{margin:10px 0 0}
    button{margin-left:6px}@media(max-width:700px){.map{height:300px}}
  `],
})
export class ActivityMapComponent implements AfterViewInit, OnDestroy {
  readonly route = input.required<ActivityMapAvailable>();
  readonly quality = computed(() => routeQuality(this.route()));
  readonly loading = signal(true);
  readonly failure = signal(false);
  readonly tilesFailed = signal(false);
  private readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('mapCanvas');
  private map?: MapInstance;
  private generation = 0;
  private destroyed = false;

  ngAfterViewInit(): void { void this.renderMap(); }
  ngOnDestroy(): void { this.destroyed = true; this.generation++; this.map?.remove(); this.map = undefined; }

  retry(): void { void this.renderMap(); }

  private async renderMap(): Promise<void> {
    const generation = ++this.generation;
    this.map?.remove();
    this.map = undefined;
    this.failure.set(false);
    this.tilesFailed.set(false);
    this.loading.set(true);

    try {
      const lib = await loadMapLibre();
      if (this.destroyed || generation !== this.generation) return;
      const route = this.route();
      const parts = route.geometry.type === 'LineString' ? [route.geometry.coordinates] : route.geometry.coordinates;
      const start = parts[0]![0]! as Coordinates;
      const last = parts[parts.length - 1]!;
      const end = last[last.length - 1]! as Coordinates;
      const map = new lib.Map({
        container: this.canvas().nativeElement,
        style: RASTER_STYLE,
        center: start,
        zoom: 11,
        attributionControl: { compact: false },
        maxZoom: 18,
      });
      this.map = map;
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', () => {
        if (!this.destroyed && generation === this.generation) this.tilesFailed.set(true);
      });
      map.on('load', () => {
        if (this.destroyed || generation !== this.generation) return;
        try {
          map.addSource('activity-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route.geometry } });
          map.addLayer({ id: 'activity-route-outline', type: 'line', source: 'activity-route', paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 } });
          map.addLayer({ id: 'activity-route', type: 'line', source: 'activity-route', paint: { 'line-color': '#2858c7', 'line-width': 4 } });
          new lib.Marker({ color: '#16a34a', scale: 0.8 }).setLngLat(start).addTo(map);
          if (start[0] !== end[0] || start[1] !== end[1]) {
            new lib.Marker({ color: '#dc2626', scale: 0.8 }).setLngLat(end).addTo(map);
          }
          const [west, south, east, north] = route.bounds;
          map.fitBounds([[west, south], [east, north]], { padding: 48, maxZoom: 15, duration: 0 });
          this.loading.set(false);
        } catch {
          this.loading.set(false);
          this.failure.set(true);
        }
      });
    } catch {
      if (this.destroyed || generation !== this.generation) return;
      this.loading.set(false);
      this.failure.set(true);
    }
  }
}
