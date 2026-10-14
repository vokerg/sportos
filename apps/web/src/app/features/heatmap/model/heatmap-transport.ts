import type { Coordinate, HeatmapPage, RouteGeometry } from './heatmap.models';

/** Precision-5 transport is lossless for the API's retained polyline geometry. */
export function decodeHeatmapPolyline(value: unknown): Coordinate[] {
  if (typeof value !== 'string' || value.length < 4 || value.length > 30_000) throw new Error('Invalid route encoding.');
  const coordinates: Coordinate[] = [];
  let i = 0, lat = 0, lng = 0;
  const delta = (): number => {
    let value = 0, shift = 0;
    for (let count = 0; count < 7; count++) {
      if (i >= encoded.length) throw new Error('Invalid route encoding.');
      const char = encoded.charCodeAt(i++) - 63;
      if (!Number.isInteger(char) || char < 0 || char > 63) throw new Error('Invalid route encoding.');
      value += (char & 31) * 2 ** shift;
      if (value > 0xffffffff) throw new Error('Invalid route encoding.');
      if (char < 32) return value % 2 ? -(value + 1) / 2 : value / 2;
      shift += 5;
    }
    throw new Error('Invalid route encoding.');
  };
  const encoded = value;
  while (i < encoded.length) {
    if (coordinates.length >= 5_000) throw new Error('Invalid route encoding.');
    lat += delta(); lng += delta();
    if (Math.abs(lat) > 9_000_000 || Math.abs(lng) > 18_000_000) throw new Error('Invalid route encoding.');
    coordinates.push([lng / 100_000, lat / 100_000]);
  }
  if (coordinates.length < 2) throw new Error('Invalid route encoding.');
  return coordinates;
}

export function decodeHeatmapPage(page: HeatmapPage): HeatmapPage {
  if (!Array.isArray(page?.items)) throw new Error('Invalid heatmap page.');
  return { ...page, items: page.items.map(item => {
    const geometry = item.geometry as unknown as { type: string; polylines?: unknown };
    if (!geometry || !('polylines' in geometry)) return item;
    if (!Array.isArray(geometry.polylines) || geometry.polylines.length < 1 || geometry.polylines.length > 50 ||
        !['LineString', 'MultiLineString'].includes(geometry.type) ||
        (geometry.type === 'LineString' && geometry.polylines.length !== 1)) throw new Error('Invalid route encoding.');
    const parts = geometry.polylines.map(decodeHeatmapPolyline);
    const decoded: RouteGeometry = geometry.type === 'LineString'
      ? { type: 'LineString', coordinates: parts[0]! } : { type: 'MultiLineString', coordinates: parts };
    return { ...item, geometry: decoded };
  }) };
}
