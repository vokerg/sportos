import { BadRequestException } from '@nestjs/common';
import { PaceSpeedTrendsRepository, type Database, type Kysely, type PaceSpeedTrendResponse } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import { PaceSpeedTrendsController, parsePaceSpeedQuery } from './pace-speed-trends.controller.js';

describe('pace speed trends API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('validates a bounded date range and allowlisted sport, granularity and threshold', () => {
    expect(parsePaceSpeedQuery({ from: '2026-01-01', to: '2026-03-01' })).toEqual({
      from: '2026-01-01', to: '2026-03-01', sport: 'run', granularity: 'weekly', threshold: null,
    });
    expect(parsePaceSpeedQuery({ from: '2026-01-01', to: '2026-03-01', sport: 'bike', granularity: 'monthly', threshold: '17' }))
      .toMatchObject({ sport: 'bike', granularity: 'monthly', threshold: 17 });
    expect(parsePaceSpeedQuery({ from: '2026-01-01', to: '2026-03-01', sport: 'swim', threshold: '120' }))
      .toMatchObject({ sport: 'swim', threshold: 120 });
    for (const raw of [
      { from: '2026-01-01', to: '2026-02-30' },
      { from: '2026-03-01', to: '2026-01-01' },
      { from: '2001-01-01', to: '2026-10-31' },
      { from: '2026-01-01' },
      { from: '2026-01-01', to: '2026-01-31', sport: 'walking' },
      { from: '2026-01-01', to: '2026-01-31', granularity: 'hourly' },
      { from: '2026-01-01', to: '2026-01-31', threshold: 'NaN' },
      { from: '2026-01-01', to: '2026-01-31', threshold: '-1' },
      { from: '2026-01-01', to: '2026-01-31', sport: 'bike', threshold: '250' },
      { from: '2026-01-01', to: '2026-01-31', ownerId: 'secret' },
      { from: '2026-01-01', to: '2026-01-31', sport: ['run', 'bike'] },
    ]) expect(() => parsePaceSpeedQuery(raw)).toThrow(BadRequestException);
  });

  it('runs only inside authenticated account context', async () => {
    const accountId = '22222222-2222-4222-8222-222222222222';
    const expected = { range: { from: '2026-01-01', to: '2026-02-01' }, sport: 'run',
      granularity: 'weekly', threshold: 360, buckets: [] } satisfies PaceSpeedTrendResponse;
    const read = vi.spyOn(PaceSpeedTrendsRepository.prototype, 'read').mockResolvedValue(expected);
    const withAccount = vi.fn((_id: string, run: (db: Kysely<Database>) => Promise<unknown>) => run({} as Kysely<Database>));
    const controller = new PaceSpeedTrendsController({ withAccount } as unknown as DbProvider);
    await expect(controller.trends({ from: '2026-01-01', to: '2026-02-01', threshold: '360' }, { id: accountId } as never))
      .resolves.toEqual(expected);
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
    expect(read).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-02-01', sport: 'run', granularity: 'weekly', threshold: 360 });
  });
});
