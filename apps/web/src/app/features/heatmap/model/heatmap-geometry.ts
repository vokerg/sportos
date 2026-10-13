import {
  MAX_DENSITY_SAMPLES, MAX_RAW_ROUTE_POINTS, MAX_HEATMAP_ROUTES,
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
  properties: { kind: 'route' | 'density'; activityId: string; source: string; resolution: string; weight?: number };
  geometry: RouteGeometry | { type: 'Point'; coordinates: Coordinate };
}
export interface HeatmapDataset {
  geojson: { type: 'FeatureCollection'; features: GeojsonFeature[] };
  bounds: [number, number, number, number] | null;
  routes: number; rawPoints: number; samples: number;
}

export function buildHeatmapDataset(routes: HeatmapRoute[]): HeatmapDataset {
  if (routes.length > MAX_HEATMAP_ROUTES) throw new RangeError('Too many routes for the browser heatmap. Narrow the filters.');
  const features: GeojsonFeature[] = [];
  let rawPoints = 0, samples = 0;
  let west = 180, east = -180, south = 90, north = -90;
  for (const route of routes) {
    if (!route?.geometry || (route.geometry.type !== 'LineString' && route.geometry.type !== 'MultiLineString')) {
      throw new RangeError('Invalid route geometry returned by the heatmap API.');
    }
    const parts = route.geometry.type === 'LineString' ? [route.geometry.coordinates] : route.geometry.coordinates;
    if (!Array.isArray(parts) || !parts.length || parts.some(part => !Array.isArray(part) || part.length < 2)) {
      throw new RangeError('Invalid route geometry returned by the heatmap API.');
    }
    const density: GeojsonFeature[] = [];
    for (const part of parts) {
      if (!part.every(validCoordinate)) throw new RangeError('Invalid route geometry returned by the heatmap API.');
      rawPoints += part.length;
      if (rawPoints > MAX_RAW_ROUTE_POINTS) throw new RangeError('Too many GPS points for the browser heatmap. Narrow the filters.');
      for (const [lng, lat] of part) {
        west = Math.min(west, lng); east = Math.max(east, lng);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
      // Do not interpolate across disjoint GPS recordings.
      const points = densifyCoordinates(part, SAMPLE_SPACING_M, MAX_DENSITY_SAMPLES - samples);
      samples += points.length;
      for (const point of points) density.push({
        type: 'Feature',
        properties: { kind: 'density', activityId: route.activityId, source: route.source, resolution: route.resolution, weight: 1 },
        geometry: { type: 'Point', coordinates: point },
      });
    }
    features.push({
      type: 'Feature',
      properties: { kind: 'route', activityId: route.activityId, source: route.source, resolution: route.resolution },
      geometry: route.geometry,
    });
    features.push(...density);
  }
  return {
    geojson: { type: 'FeatureCollection', features },
    bounds: routes.length ? [west, south, east, north] : null,
    routes: routes.length, rawPoints, samples,
  };
}
