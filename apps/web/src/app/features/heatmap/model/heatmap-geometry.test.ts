import { describe, expect, it } from 'vitest';
import { buildHeatmapDataset, densifyCoordinates, HeatmapDatasetBuilder, simplifyCoordinates } from './heatmap-geometry';
import type { HeatmapRoute } from './heatmap.models';

const route = (geometry: HeatmapRoute['geometry']): HeatmapRoute => ({
  activityId: 'route-1', date: '2026-08-01', sport: 'run', source: 'strava',
  resolution: 'summary', geometry,
});

describe('heatmap summary geometry', () => {
  it('interpolates sparse points for visual density without changing endpoints', () => {
    const input: [number,number][] = [[12,55],[12.001,55]];
    const sample = densifyCoordinates(input, 30);
    expect(sample.length).toBeGreaterThan(2);
    expect(sample[0]).toEqual(input[0]);
    expect(sample[sample.length-1]).toEqual(input[1]);
    expect(sample.every(p => p[1] === 55)).toBe(true);
  });
  it('keeps discontinuous parts separate, including density interpolation and raw route geometry', () => {
    const geometry = { type: 'MultiLineString' as const, coordinates: [
      [[12,55],[12.0002,55]],[[13,56],[13.0002,56]],
    ] as [number,number][][] };
    const result = buildHeatmapDataset([route(geometry)]);
    expect(result.routes).toBe(1);
    expect(result.rawPoints).toBe(4);
    expect(result.bounds).toEqual([12,55,13.0002,56]);
    expect(result.geojson.features[0]?.geometry).toEqual(geometry);
    const density = result.geojson.features.slice(1).map(p => p.geometry);
    expect(density.some(p => p.type === 'Point' && p.coordinates[0] > 12.02 && p.coordinates[0] < 12.98)).toBe(false);
  });
  it('aggregates repeat visits at three resolutions instead of duplicating density features', () => {
    const line = route({type:'LineString',coordinates:[[12,55],[12.001,55]]});
    const once = buildHeatmapDataset([line]);
    const builder = new HeatmapDatasetBuilder();
    builder.add([line]); builder.add([{...line,activityId:'route-2'}]);
    const twice = builder.finish();
    expect(twice.routes).toBe(2);
    expect(twice.samples).toBe(once.samples * 2);
    expect(twice.densityCells).toBe(once.densityCells);
    const cells = (data: typeof once) => data.geojson.features.filter(f => f.properties.kind === 'density');
    expect(new Set(cells(twice).map(f => f.properties.level))).toEqual(new Set([0,1,2]));
    expect(cells(twice).map(f => f.properties.weight)).toEqual(cells(once).map(f => f.properties.weight! * 2));
  });
  it('samples by distance independently of source point frequency and keeps important turns', () => {
    const sparse = route({type:'LineString',coordinates:[[12,55],[12.01,55]]});
    const dense = route({type:'LineString',coordinates:Array.from({length:101},(_,i)=>[12+i*0.0001,55])});
    expect(buildHeatmapDataset([dense]).samples).toBe(buildHeatmapDataset([sparse]).samples);
    expect(buildHeatmapDataset([dense]).renderedPoints).toBe(2);
    expect(simplifyCoordinates([[12,55],[12.001,55.001],[12.002,55]])).toHaveLength(3);
  });
  it('handles empty input, repeated points, and invalid/malformed geometry', () => {
    expect(buildHeatmapDataset([]).bounds).toBeNull();
    expect(densifyCoordinates([])).toEqual([]);
    expect(densifyCoordinates([[12,55],[12,55]])).toEqual([[12,55],[12,55]]);
    expect(() => buildHeatmapDataset([route({type:'LineString',coordinates:[[12,55]]})])).toThrow();
    expect(() => buildHeatmapDataset([route({type:'MultiLineString',coordinates:[]})])).toThrow();
    expect(() => densifyCoordinates([[Number.NaN,55],[12,55]])).toThrow();
    expect(() => densifyCoordinates([[181,55],[12,55]])).toThrow();
  });
  it('refuses oversized sampling rather than rendering a deceptively truncated route', () => {
    expect(() => densifyCoordinates([[12,55],[12.02,55]], 10, 3)).toThrow(/budget/);
    expect(() => densifyCoordinates([[12,55],[12.001,55]], 80, 1)).toThrow(/budget/);
    expect(() => densifyCoordinates([[12,55],[12.001,55]], 0)).toThrow(/budget/);
  });
});
