import { describe, expect, it } from 'vitest';
import { HEATMAP_SOURCE_ID, heatmapLayers, heatmapRasterStyle } from './heatmap-style';

describe('ported heatmap style', () => {
  it('layers density at lower zoom and individual route lines at street zoom', () => {
    const layers = heatmapLayers() as Array<{id:string; type:string; source:string; filter: unknown; minzoom?:number; maxzoom?:number; paint:Record<string,unknown>}>;
    expect(layers.map(l => l.id)).toEqual(['heatmap-halo-0','heatmap-halo-1','heatmap-halo-2','heatmap-core-0','heatmap-core-1','heatmap-core-2','route-glow','route-core']);
    expect(layers.map(l => l.source)).toEqual(Array(8).fill(HEATMAP_SOURCE_ID));
    expect(layers.slice(0,6).every(l => l.type === 'heatmap' && l.maxzoom! < 15)).toBe(true);
    expect(layers.slice(6).every(l => l.type === 'line' && l.minzoom! >= 13)).toBe(true);
    expect(layers.slice(0,6).every(l => JSON.stringify(l.filter).includes('density'))).toBe(true);
    expect(layers.slice(6).every(l => JSON.stringify(l.filter).includes('route'))).toBe(true);
    expect(layers.slice(0, 3).map(l => [l.minzoom, l.maxzoom])).toEqual([[0,10],[10,13],[13,14.7]]);
    expect(layers.slice(0, 6).every(l => JSON.stringify(l.filter).includes('level'))).toBe(true);
    expect(layers[0]?.paint['heatmap-color']).toBeTruthy();
  });
  it('uses only public raster tiles and does not include private routes in tile URLs', () => {
    const style = heatmapRasterStyle() as {sources:{osm:{tiles:string[],attribution:string}}};
    expect(style.sources.osm.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
    expect(style.sources.osm.attribution).toMatch(/OpenStreetMap/);
    expect(JSON.stringify(style)).not.toMatch(/activities|heatmap\/routes|\.geojson|\.mvt/);
  });
});
