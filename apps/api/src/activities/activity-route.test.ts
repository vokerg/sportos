import { describe, expect, it } from 'vitest';
import { stravaSummaryRoute } from './activity-route.js';

const example = '_p~iF~ps|U_ulLnnqC_mqNvxq' + String.fromCharCode(96) + '@';

describe('Strava summary route decoding', () => {
  it('decodes precision-5 encoded latitude-first points into GeoJSON longitude-first coordinates and bounds', () => {
    expect(stravaSummaryRoute(example, 'string')).toEqual({
      status: 'available',
      source: 'strava',
      resolution: 'summary',
      geometry: { type: 'LineString', coordinates: [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]] },
      bounds: [-126.453, 38.5, -120.2, 43.252],
      pointCount: 3,
    });
  });

  it('distinguishes missing summaries from malformed payloads', () => {
    for (const [encoded, kind] of [[null, null], ['', 'string'], [null, 'null']] as const) {
      expect(stravaSummaryRoute(encoded, kind)).toEqual({ status: 'unavailable', reason: 'summary_polyline_missing' });
    }
    for (const [encoded, kind] of [
      ['garbage', 'object'], ['bad?', 'string'], ['?', 'string'], ['??', 'string'],
      [example.slice(0, -1), 'string'], ['!abc', 'string'],
      ['??'.repeat(5_001), 'string'], ['x'.repeat(30_001), 'string'],
    ] as const) {
      expect(stravaSummaryRoute(encoded, kind)).toEqual({ status: 'unavailable', reason: 'invalid_geometry' });
    }
  });

  it('rejects out-of-range, overflow, and degenerate paths but accepts a returning loop', () => {
    expect(stravaSummaryRoute(encodeDelta(10_000_000) + '???', 'string')).toEqual({
      status: 'unavailable', reason: 'invalid_geometry',
    });
    expect(stravaSummaryRoute('~~~~~~~~', 'string')).toEqual({
      status: 'unavailable', reason: 'invalid_geometry',
    });
    expect(stravaSummaryRoute('??????', 'string')).toEqual({
      status: 'unavailable', reason: 'invalid_geometry',
    });
    const loop = '??' + encodeDelta(0) + encodeDelta(100_000) + encodeDelta(0) + encodeDelta(-100_000);
    expect(stravaSummaryRoute(loop, 'string')).toMatchObject({
      status: 'available', geometry: { coordinates: [[0, 0], [1, 0], [0, 0]] }, pointCount: 3,
    });
  });
});

function encodeDelta(delta: number): string {
  let value = delta < 0 ? -delta * 2 - 1 : delta * 2;
  let encoded = '';
  while (value >= 32) {
    encoded += String.fromCharCode((value % 32) + 95);
    value = Math.floor(value / 32);
  }
  return encoded + String.fromCharCode(value + 63);
}
