import {
  MAX_DENSITY_SAMPLES, MAX_RAW_ROUTE_POINTS, MAX_HEATMAP_ROUTES, MAX_RENDERED_ROUTE_POINTS, MAX_DENSITY_CELLS,
  type Coordinate, type HeatmapRoute, type RouteGeometry,
} from './heatmap.models';

/**
 * Adapted from vokerg/heatmap/apps/api/src/db/file-store.ts.
 * Interpolation evens out heatmap samples; it does NOT reconstruct a GPS path.
 * Every segment has an explicit global output budget. No persistence.
 */
const RADIANS = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;
const SAMPLE_SPACING_M = 80;

function validCoordinate(point: Coordinate): boolean {
  return Array.isArray(point) && point.length === 2 &&
    Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const lat = (b[1] - a[1]) * RADIANS;
  const lng = (b[0] - a[0]) * RADIANS;
  const h = Math.sin(lat / 2) ** 2 +
    Math.cos(a[1] * RADIANS) * Math.cos(b[1] * RADIANS) * Math.sin(lng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function densifyCoordinates(
  coordinates: Coordinate[], maxSegmentMeters = SAMPLE_SPACING_M, maxPoints = MAX_DENSITY_SAMPLES,
): Coordinate[] {
  if (!Number.isFinite(maxSegmentMeters) || maxSegmentMeters <= 0 ||
      !Number.isSafeInteger(maxPoints) || maxPoints < 0) throw new RangeError('Invalid heatmap sampling budget.');
  if (!coordinates.every(validCoordinate)) throw new RangeError('Invalid GPS coordinate.');
  if (coordinates.length > maxPoints) throw new RangeError('Heatmap density point budget exceeded.');
  if (!coordinates.length) return [];
  const samples: Coordinate[] = [coordinates[0]!];
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]!, b = coordinates[i]!;
    const steps = Math.max(1, Math.ceil(distanceMeters(a, b) / maxSegmentMeters));
    if (!Number.isFinite(steps) || samples.length + steps > maxPoints) {
      throw new RangeError('Heatmap density point budget exceeded.');
    }
    for (let n = 1; n <= steps; n++) {
      const t = n / steps;
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return samples;
}

export interface GeojsonFeature {
  type: 'Feature';
  properties: { kind: 'route' | 'density'; activityId: string; source: string; resolution: string; weight?: number; level?: number };
  geometry: RouteGeometry | { type: 'Point'; coordinates: Coordinate };
}
export interface HeatmapDataset {
  geojson: { type: 'FeatureCollection'; features: GeojsonFeature[] };
  bounds: [number, number, number, number] | null;
  routes: number; rawPoints: number; renderedPoints: number; samples: number; densityCells: number;
}

/** Iterative Douglas–Peucker in local metres, preserving endpoints and turns.
 * Display-only simplification; never modifies retained evidence. */
export function simplifyCoordinates(points: Coordinate[], toleranceMeters = 10): Coordinate[] {
  if (points.length < 3) return points;
  const cosine = Math.max(0.000001, Math.cos(points[0]![1] * RADIANS));
  const metres = EARTH_RADIUS_M * RADIANS;
  const kept = new Uint8Array(points.length);
  kept[0] = 1; kept[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const a = points[start]!, b = points[end]!;
    const dx = (b[0] - a[0]) * cosine * metres, dy = (b[1] - a[1]) * metres;
    const length = dx * dx + dy * dy;
    let farthest = -1, maximum = toleranceMeters * toleranceMeters;
    for (let i = start + 1; i < end; i++) {
      const p = points[i]!;
      const x = (p[0] - a[0]) * cosine * metres, y = (p[1] - a[1]) * metres;
      const t = length ? Math.max(0, Math.min(1, (x * dx + y * dy) / length)) : 0;
      const distance = (x - t * dx) ** 2 + (y - t * dy) ** 2;
      if (distance > maximum) { maximum = distance; farthest = i; }
    }
    if (farthest >= 0) {
      kept[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, i) => kept[i]);
}

/** Pages are consumed and released immediately. Shared weighted cells replace
 * millions of duplicate Point features. Three resolutions switch with zoom. */
export class HeatmapDatasetBuilder {
  private readonly lines: GeojsonFeature[] = [];
  private readonly cells = new Map<string, { point: Coordinate; weight: number; level: number }>();
  private rawPoints = 0;
  private renderedPoints = 0;
  private samples = 0;
  private west = 180;
  private east = -180;
  private south = 90;
  private north = -90;

  add(routes: HeatmapRoute[]): void {
    if (this.lines.length + routes.length > MAX_HEATMAP_ROUTES) throw new RangeError('Too many routes for the browser heatmap. Narrow the filters.');
    for (const route of routes) {
      if (!route?.geometry || (route.geometry.type !== 'LineString' && route.geometry.type !== 'MultiLineString')) throw new RangeError('Invalid route geometry.');
      const parts = route.geometry.type === 'LineString' ? [route.geometry.coordinates] : route.geometry.coordinates;
      if (!Array.isArray(parts) || !parts.length || parts.length > 50 || parts.some(part => !Array.isArray(part) || part.length < 2 || part.length > 5_000) || parts.reduce((count, part) => count + part.length, 0) > 5_000) throw new RangeError('Invalid route geometry.');
      const display: Coordinate[][] = [];
      for (const part of parts) {
        if (!part.every(validCoordinate)) throw new RangeError('Invalid GPS coordinate.');
        this.rawPoints += part.length;
        if (this.rawPoints > MAX_RAW_ROUTE_POINTS) throw new RangeError('Too many GPS points for the browser heatmap. Narrow the filters.');
        for (const [lng, lat] of part) {
          this.west = Math.min(this.west, lng); this.east = Math.max(this.east, lng);
          this.south = Math.min(this.south, lat); this.north = Math.max(this.north, lat);
        }
        const simplified = simplifyCoordinates(part);
        this.renderedPoints += simplified.length;
        if (this.renderedPoints > MAX_RENDERED_ROUTE_POINTS) throw new RangeError('Too many displayed route points. Narrow the filters.');
        display.push(simplified);
        // Uniform distance sampling prevents dense rich streams from appearing
        // brighter than the same path represented by a sparse summary.
        this.sample(part[0]!);
        let remaining = SAMPLE_SPACING_M;
        for (let i = 1; i < part.length; i++) {
          const a = part[i - 1]!, b = part[i]!;
          const distance = distanceMeters(a, b);
          if (!distance) continue;
          let travelled = remaining;
          while (travelled <= distance) {
            const t = travelled / distance;
            this.sample([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            travelled += SAMPLE_SPACING_M;
          }
          remaining = travelled - distance;
        }
      }
      this.lines.push({ type: 'Feature',
        properties: { kind: 'route', activityId: route.activityId, source: route.source, resolution: route.resolution },
        geometry: route.geometry.type === 'LineString'
          ? { type: 'LineString', coordinates: display[0]! }
          : { type: 'MultiLineString', coordinates: display },
      });
    }
  }

  private sample(point: Coordinate): void {
    if (++this.samples > MAX_DENSITY_SAMPLES) throw new RangeError('Heatmap density sampling budget exceeded. Narrow the filters.');
    for (const [level, size] of [1280, 320, 80].entries()) {
      const latStep = size / (EARTH_RADIUS_M * RADIANS);
      const y = Math.floor(point[1] / latStep);
      const lat = Math.max(-90, Math.min(90, (y + 0.5) * latStep));
      const lngStep = latStep / Math.max(0.000001, Math.cos(lat * RADIANS));
      const x = Math.floor(point[0] / lngStep);
      const key = `${level}:${x}:${y}`;
      const previous = this.cells.get(key);
      if (previous) previous.weight++;
      else {
        if (this.cells.size >= MAX_DENSITY_CELLS) throw new RangeError('Heatmap density cell budget exceeded. Narrow the filters.');
        // Display density only; these centres are never route vertices.
        this.cells.set(key, { point: [Math.max(-180, Math.min(180, (x + 0.5) * lngStep)), lat], weight: 1, level });
      }
    }
  }

  finish(): HeatmapDataset {
    const features = [...this.lines];
    for (const cell of this.cells.values()) features.push({ type: 'Feature',
      properties: { kind: 'density', activityId: '', source: 'aggregate', resolution: 'density', weight: cell.weight, level: cell.level },
      geometry: { type: 'Point', coordinates: cell.point },
    });
    return { geojson: { type: 'FeatureCollection', features },
      bounds: this.lines.length ? [this.west, this.south, this.east, this.north] : null,
      routes: this.lines.length, rawPoints: this.rawPoints, renderedPoints: this.renderedPoints,
      samples: this.samples, densityCells: this.cells.size,
    };
  }
}

export function buildHeatmapDataset(routes: HeatmapRoute[]): HeatmapDataset {
  const builder = new HeatmapDatasetBuilder();
  builder.add(routes);
  return builder.finish();
}
