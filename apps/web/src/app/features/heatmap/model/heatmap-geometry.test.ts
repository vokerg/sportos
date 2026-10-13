import { describe, expect, it } from 'vitest';
import { buildHeatmapDataset, densifyCoordinates } from './heatmap-geometry';
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
    expect(density.some(p => p.type === 'Point' && p.coordinates[0] > 12.0002 && p.coordinates[0] < 13)).toBe(false);
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
