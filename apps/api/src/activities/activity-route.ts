/** Read-only display geometry from retained Strava compact source evidence. */
export type ActivityRouteResponse =
  | { status: 'available'; source: 'strava' | 'garmin'; resolution: 'summary' | 'streams' | 'detail' | 'fit'; geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'MultiLineString'; coordinates: [number, number][][] }; bounds: [number, number, number, number]; pointCount: number }
  | { status: 'unavailable'; reason: 'no_gps' | 'summary_polyline_missing' | 'invalid_geometry' };

const MAX_ENCODED_LENGTH = 30_000;
const MAX_POINTS = 5_000;
const MAX_COORDINATES_JSON_LENGTH = 200_000;

const invalid = (): ActivityRouteResponse => ({ status: 'unavailable', reason: 'invalid_geometry' });

/** Strava precision-5 polyline coordinates are latitude first; GeoJSON is longitude first. */
export function stravaSummaryRoute(polyline: string | null, polylineType: string | null): ActivityRouteResponse {
  if (polylineType === null || polylineType === 'null' || (polylineType === 'string' && !polyline)) {
    return { status: 'unavailable', reason: 'summary_polyline_missing' };
  }
  if (polylineType !== 'string' || typeof polyline !== 'string' || polyline.length > MAX_ENCODED_LENGTH) return invalid();

  const coordinates: [number, number][] = [];
  let latitude = 0;
  let longitude = 0;
  let offset = 0;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  while (offset < polyline.length) {
    if (coordinates.length >= MAX_POINTS) return invalid();
    const lat = readDelta(polyline, offset);
    if (!lat) return invalid();
    const lon = readDelta(polyline, lat.next);
    if (!lon) return invalid();
    latitude += lat.delta;
    longitude += lon.delta;
    offset = lon.next;
    if (!Number.isSafeInteger(latitude) || !Number.isSafeInteger(longitude)
      || latitude < -9_000_000 || latitude > 9_000_000
      || longitude < -18_000_000 || longitude > 18_000_000) return invalid();
    const latDegrees = latitude / 100_000;
    const lonDegrees = longitude / 100_000;
    coordinates.push([lonDegrees, latDegrees]);
    west = Math.min(west, lonDegrees);
    east = Math.max(east, lonDegrees);
    south = Math.min(south, latDegrees);
    north = Math.max(north, latDegrees);
  }
  if (coordinates.length < 2 || (west === east && south === north)
    || JSON.stringify(coordinates).length > MAX_COORDINATES_JSON_LENGTH) return invalid();
  return { status: 'available', source: 'strava', resolution: 'summary',
    geometry: { type: 'LineString', coordinates }, bounds: [west, south, east, north], pointCount: coordinates.length };
}

function readDelta(input: string, start: number): { delta: number; next: number } | null {
  let unsigned = 0;
  let shift = 0;
  let cursor = start;
  for (let chunks = 0; chunks < 7; chunks++) {
    if (cursor >= input.length) return null;
    const chunk = input.charCodeAt(cursor++) - 63;
    if (chunk < 0 || chunk > 63) return null;
    unsigned += (chunk & 31) * 2 ** shift;
    if (unsigned > 0xffff_ffff) return null;
    if (chunk < 32) {
      return { delta: unsigned % 2 === 0 ? unsigned / 2 : -(unsigned + 1) / 2, next: cursor };
    }
    shift += 5;
  }
  return null;
}
