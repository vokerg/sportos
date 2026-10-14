import { BadRequestException } from '@nestjs/common';
import { HeatmapRoutesRepository, type Database, type Kysely } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import { HeatmapController, assembleHeatmapRoutes, encodeHeatmapCursor, parseHeatmapQuery } from './heatmap.controller.js';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const owner = '33333333-3333-4333-8333-333333333333';
const example = '_p~iF~ps|U_ulLnnqC_mqNvxq' + String.fromCharCode(96) + '@';
const candidate = (id: string, date: string, polyline: string | null = example, polylineType: string | null = 'string') =>
  ({ activityId: id, date, sport: 'run' as const, polyline, polylineType });

describe('heatmap routes API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('validates only bounded canonical filters, real dates and well-formed stable cursors', () => {
    const cursor = encodeHeatmapCursor('2026-01-02', first);
    expect(parseHeatmapQuery({
      from: '2026-01-01', to: '2026-01-31', activityType: 'walk', limit: '50', cursor,
    })).toEqual({
      from: '2026-01-01', to: '2026-01-31', activityType: 'walk', limit: 50,
      cursor: { date: '2026-01-02', id: first },
    });
    expect(parseHeatmapQuery({})).toEqual({
      from: undefined, to: undefined, activityType: undefined, limit: 25, cursor: undefined,
    });
    for (const input of [
      { from: '2026-02-30' }, { from: '2026-02-02', to: '2026-02-01' },
      { activityType: 'strava' }, { sport: 'run' }, { ownerId: owner },
      { limit: '0' }, { limit: '51' }, { limit: 'NaN' }, { limit: ['10'] },
      { cursor: 'invalid' }, { cursor: '' },
      { cursor: encodeHeatmapCursor('2026-02-30', first) },
      { cursor: encodeHeatmapCursor('2026-01-02', 'bad-uuid') },
      { cursor: encodeHeatmapCursor('2026-01-02', first) + '=' },
    ]) expect(() => parseHeatmapQuery(input)).toThrow(BadRequestException);
  });

  it('offers a larger bounded lossless encoded page without changing default GeoJSON limits', () => {
    expect(parseHeatmapQuery({encoding:'polyline5',limit:'200'})).toMatchObject({encoding:'polyline5',limit:200});
    for (const input of [{encoding:'unknown'},{encoding:'polyline5',limit:'201'},{limit:'200'}]) {
      expect(() => parseHeatmapQuery(input)).toThrow();
    }
    const result = assembleHeatmapRoutes([candidate(first,'2026-01-01')],false,200,new Map(),'polyline5');
    expect(result.items[0]?.geometry).toEqual({type:'LineString',polylines:[example]});
    const long = '??' + 'A?'.repeat(4_999);
    expect(assembleHeatmapRoutes(Array.from({length:200},()=>candidate(first,'2026-01-01',long)),
      false,200,new Map(),'polyline5').coverage.budgetExceeded).toBeGreaterThan(0);
  });

  it('never returns invalid, missing or over-budget geometry; reports coverage and advances past all scanned candidates', () => {
    const result = assembleHeatmapRoutes([
      candidate(first, '2026-01-04'),
      candidate(second, '2026-01-03', null, null),
      candidate(first, '2026-01-02', 'bad?', 'string'),
    ], true, 3);
    expect(result.items).toEqual([{
      activityId: first, date: '2026-01-04', sport: 'run', source: 'strava', resolution: 'summary',
      geometry: { type: 'LineString', coordinates: [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]] },
    }]);
    expect(result.coverage).toEqual({
      eligibleScanned: 3, usable: 1, missingGps: 1, invalidGeometry: 1, budgetExceeded: 0,
      quality: { summary: 1, streams: 0, detail: 0, fit: 0 },
    });
    expect(result.nextCursor).toBe(encodeHeatmapCursor('2026-01-02', first));
    expect(result.hasMore).toBe(true);
    expect(result.partial).toBe(true);

    // Valid individual tracks must not combine into an unbounded response.
    const largeTrack = '??' + 'A?'.repeat(4_999);
    const large = assembleHeatmapRoutes(Array.from({ length: 4 }, (_, i) =>
      candidate(first, '2026-01-01', largeTrack)), false, 4);
    expect(large.coverage).toMatchObject({ eligibleScanned: 4, usable: 3, budgetExceeded: 1 });
    expect(large.nextCursor).toBeNull();
    expect(large.partial).toBe(true);
    expect(assembleHeatmapRoutes([candidate(first, '2026-01-01')], false, 1).partial).toBe(false);
    const rich = { status: 'available' as const, source: 'strava' as const,
      resolution: 'streams' as const, pointCount: 4, bounds: [12,55,13,56] as [number,number,number,number],
      geometry: { type: 'MultiLineString' as const, coordinates: [
        [[12,55],[12.001,55]] as [number,number][],
        [[13,56],[13.001,56]] as [number,number][],
      ] },
    };
    const mixed = assembleHeatmapRoutes([candidate(first,'2026-01-05'), candidate(second,'2026-01-04')],
      false, 2, new Map([[second, rich]]));
    expect(mixed.items[1]).toMatchObject({source:'strava',resolution:'streams',geometry:{type:'MultiLineString'}});
    expect(mixed.coverage.quality).toEqual({summary:1,streams:1,detail:0,fit:0});
    const oversizedRich = { ...rich, pointCount: 15_001 };
    const preserved = assembleHeatmapRoutes([candidate(first,'2026-01-05')],false,1,
      new Map([[first, oversizedRich]]));
    expect(preserved.items).toHaveLength(1);
    expect(preserved.items[0]?.resolution).toBe('summary');
    expect(preserved.coverage).toMatchObject({budgetExceeded:0,quality:{summary:1,streams:0}});
  });

  it('uses trusted Strava summaries on auxiliary outage and does not substitute Garmin-only GPS', async () => {
    const list = vi.spyOn(HeatmapRoutesRepository.prototype, 'list').mockResolvedValue({
      candidates: [
        { ...candidate(first, '2026-01-03'), stravaLinked: true },
        { ...candidate(second, '2026-01-02', null, null),
          stravaLinked: false, garminIdentityKey: 'native:123', garminCurrentHash: 'c'.repeat(64) },
      ],
      hasMore: false,
    });
    const withAccount = vi.fn(async <T>(_account: string, run: (db: Kysely<Database>) => Promise<T>) =>
      run({} as Kysely<Database>));
    const detail = { withAccount: vi.fn().mockRejectedValue(new Error('auxiliary unavailable')) };
    const controller = new HeatmapController({ withAccount } as unknown as DbProvider, detail as never);
    const result = await controller.routes({}, { id: owner } as never);
    expect(list).toHaveBeenCalledOnce();
    expect(withAccount).toHaveBeenCalledWith(owner, expect.any(Function));
    expect(detail.withAccount).toHaveBeenCalledOnce();
    expect(result.items).toMatchObject([{ activityId: first, source: 'strava', resolution: 'summary' }]);
    expect(result.coverage).toMatchObject({
      eligibleScanned: 2, usable: 1, missingGps: 1, quality: { summary: 1, streams: 0, detail: 0, fit: 0 },
    });
  });

  it('performs exactly one owner-scoped repository page and never downloads provider detail', async () => {
    const list = vi.spyOn(HeatmapRoutesRepository.prototype, 'list').mockResolvedValue({
      candidates: [candidate(first, '2026-01-03'), candidate(second, '2026-01-02', null, null)],
      hasMore: true,
    });
    const withAccount = vi.fn(async <T>(_account: string, run: (db: Kysely<Database>) => Promise<T>) => run({} as Kysely<Database>));
    const controller = new HeatmapController({ withAccount } as unknown as DbProvider);
    const result = await controller.routes({ activityType: 'run', limit: '2' }, { id: owner } as never);
    expect(withAccount).toHaveBeenCalledOnce();
    expect(withAccount).toHaveBeenCalledWith(owner, expect.any(Function));
    expect(list).toHaveBeenCalledWith({
      from: undefined, to: undefined, activityType: 'run', limit: 2, cursor: undefined,
    });
    expect(result.items).toHaveLength(1);
    expect(result.coverage).toMatchObject({ eligibleScanned: 2, missingGps: 1 });
    expect(result.hasMore).toBe(true);
  });
});
