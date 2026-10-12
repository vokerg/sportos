/**
 * Lazy, version-pinned MapLibre GL v5 browser bundle. The standalone CDN bundle
 * avoids changing the application's frozen pnpm lockfile for a single map view.
 * The map is only requested after an authenticated activity returns GPS geometry.
 */
const VERSION = '5.12.0';
const BASE = 'https://cdn.jsdelivr.net/npm/maplibre-gl@' + VERSION + '/dist/';
const STYLE_ID = 'sportos-maplibre-style';

export type Coordinates = [number, number];
export interface MapInstance {
  on(event: 'load' | 'error', listener: () => void): MapInstance;
  addSource(id: string, source: object): void;
  addLayer(layer: object): void;
  fitBounds(bounds: [Coordinates, Coordinates], options: object): void;
  addControl(control: unknown, position: string): void;
  remove(): void;
}
interface MarkerInstance {
  setLngLat(coordinates: Coordinates): MarkerInstance;
  addTo(map: MapInstance): MarkerInstance;
}
export interface MapLibreNamespace {
  Map: new (options: object) => MapInstance;
  Marker: new (options: object) => MarkerInstance;
  NavigationControl: new (options: object) => unknown;
}
let pending: Promise<MapLibreNamespace> | undefined;

export function loadMapLibre(): Promise<MapLibreNamespace> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('MapLibre requires a browser'));
  }
  const global = window as Window & { maplibregl?: MapLibreNamespace };
  if (global.maplibregl) return Promise.resolve(global.maplibregl);
  if (pending) return pending;

  pending = new Promise<MapLibreNamespace>((resolve, reject) => {
    if (!document.getElementById(STYLE_ID)) {
      const link = document.createElement('link');
      link.id = STYLE_ID;
      link.rel = 'stylesheet';
      link.href = BASE + 'maplibre-gl.css';
      link.referrerPolicy = 'no-referrer';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = BASE + 'maplibre-gl.js';
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.onload = () => {
      if (global.maplibregl) resolve(global.maplibregl);
      else { pending = undefined; script.remove(); reject(new Error('MapLibre did not initialize')); }
    };
    script.onerror = () => {
      pending = undefined;
      script.remove();
      reject(new Error('MapLibre script could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return pending;
}
