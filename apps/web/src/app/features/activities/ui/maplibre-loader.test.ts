// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMapLibre, type MapLibreNamespace } from './maplibre-loader';

const maplibre = { Map: class {}, Marker: class {}, NavigationControl: class {} } as unknown as MapLibreNamespace;
const global = window as Window & { maplibregl?: MapLibreNamespace };

function script() {
  return document.querySelector<HTMLScriptElement>('script[src*="maplibre-gl.js"]')!;
}
function stylesheet() {
  return document.getElementById('sportos-maplibre-style') as HTMLLinkElement;
}
function succeedScript() {
  global.maplibregl = maplibre;
  script().dispatchEvent(new Event('load'));
}

afterEach(() => {
  document.querySelectorAll('script[src*="maplibre-gl.js"]').forEach(node => node.remove());
  // Keep a successfully loaded stylesheet: the loader caches it for subsequent maps.
  delete global.maplibregl;
});

describe('MapLibre browser loader', () => {
  it('shares a pending request and waits for both JS and stylesheet before rendering markers', async () => {
    const first = loadMapLibre();
    const second = loadMapLibre();
    expect(second).toBe(first);
    expect(script().src).toContain('maplibre-gl@5.12.0');
    expect(stylesheet().href).toContain('maplibre-gl@5.12.0');
    let resolved = false;
    void first.then(() => { resolved = true; });
    succeedScript();
    await Promise.resolve();
    expect(resolved).toBe(false);
    stylesheet().dispatchEvent(new Event('load'));
    expect(await first).toBe(maplibre);
    expect(resolved).toBe(true);
  });
  it('keeps working when a subsequent map opens with an already loaded stylesheet', async () => {
    global.maplibregl = maplibre;
    expect(await loadMapLibre()).toBe(maplibre);
  });
  it('explains failures instead of hanging on a failed CDN stylesheet', async () => {
    // A URL failure is tested via an isolated module instance, not the cached success above.
    vi.resetModules();
    const loader = await import('./maplibre-loader');
    delete global.maplibregl;
    const request = loader.loadMapLibre();
    stylesheet().dispatchEvent(new Event('error'));
    await expect(request).rejects.toThrow('stylesheet could not be loaded');
    expect(stylesheet()).toBeNull();
    expect(document.querySelectorAll('script[src*="maplibre-gl.js"]')).toHaveLength(0);
  });
});
