/**
 * Lazy, version-pinned MapLibre GL v5 browser bundle. The standalone CDN bundle
 * avoids changing the application's frozen pnpm lockfile for a single map view.
 * The map is only requested after an authenticated route dataset is ready.
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
let stylesheetLoaded = false;

export function loadMapLibre(): Promise<MapLibreNamespace> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('MapLibre requires a browser'));
  }
  const global = window as Window & { maplibregl?: MapLibreNamespace };
  if (pending) return pending;
  if (global.maplibregl && stylesheetLoaded) return Promise.resolve(global.maplibregl);

  pending = new Promise<MapLibreNamespace>((resolve, reject) => {
    let cssReady = stylesheetLoaded;
    let jsReady = Boolean(global.maplibregl);
    let settled = false;
    let script: HTMLScriptElement | undefined;
    let link: HTMLLinkElement | undefined;

    const complete = () => {
      if (settled || !cssReady || !jsReady) return;
      settled = true;
      resolve(global.maplibregl!);
    };
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      pending = undefined;
      script?.remove();
      if (link && !stylesheetLoaded) link.remove();
      reject(new Error(reason));
    };

    if (!cssReady) {
      // A previous unsuccessful attempt must not poison retries.
      document.getElementById(STYLE_ID)?.remove();
      link = document.createElement('link');
      link.id = STYLE_ID;
      link.rel = 'stylesheet';
      link.href = BASE + 'maplibre-gl.css';
      link.referrerPolicy = 'no-referrer';
      link.onload = () => {
        if (settled) return;
        cssReady = true;
        stylesheetLoaded = true;
        complete();
      };
      link.onerror = () => fail('MapLibre stylesheet could not be loaded');
      document.head.appendChild(link);
    }
    if (!jsReady) {
      script = document.createElement('script');
      script.src = BASE + 'maplibre-gl.js';
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.onload = () => {
        if (settled) return;
        if (!global.maplibregl) {
          fail('MapLibre did not initialize');
          return;
        }
        jsReady = true;
        complete();
      };
      script.onerror = () => fail('MapLibre script could not be loaded');
      document.head.appendChild(script);
    }
    complete();
  });
  return pending;
}
