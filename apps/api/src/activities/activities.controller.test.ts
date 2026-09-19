import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivitiesRepository, type Database, type Kysely } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import { ActivitiesController, parseActivitiesQuery } from './activities.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const account = { id: accountId } as never;

describe('ActivitiesController', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists with bounded defaults and validated type, date, and source filters in account context', async () => {
    const list = vi.spyOn(ActivitiesRepository.prototype, 'list').mockResolvedValue({ items: [], summary: { count: 0, durationS: 0, distanceM: 0 }, limit: 50, offset: 0 });
    const { controller, withAccount } = createController();
    await controller.list({}, account);
    expect(list).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    await controller.list({ from: '2026-01-01', to: '2026-01-31', activityType: 'bike', source: 'garmin', limit: '25', offset: '50' }, account);
    expect(list).toHaveBeenLastCalledWith({ from: '2026-01-01', to: '2026-01-31', activityType: 'bike', source: 'garmin', limit: 25, offset: 50 });
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
  });

  it('rejects invalid and private filters before repository access', () => {
    for (const query of [
      { activityType: 'cycle' }, { source: 'unknown' }, { from: '2026-02-30' },
      { from: '2026-03-01', to: '2026-02-01' }, { limit: '101' }, { offset: '-1' },
      { ownerId: accountId }, { source: ['strava', 'garmin'] },
    ]) expect(() => parseActivitiesQuery(query)).toThrow(BadRequestException);
  });

  it('fetches an activity and returns the same 404 for missing or foreign IDs', async () => {
    const get = vi.spyOn(ActivitiesRepository.prototype, 'get').mockResolvedValueOnce({ id } as never).mockResolvedValue(null);
    const { controller, withAccount } = createController();
    await expect(controller.detail(id, account)).resolves.toMatchObject({ id });
    await expect(controller.detail(id, account)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.detail(id, account)).rejects.toBeInstanceOf(NotFoundException);
    expect(get).toHaveBeenCalledTimes(3);
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
  });
});

function createController() {
  const scopedDb = {} as Kysely<Database>;
  const withAccount = vi.fn(async <T>(_accountId: string, callback: (db: Kysely<Database>) => Promise<T>) => callback(scopedDb));
  return { controller: new ActivitiesController({ withAccount } as unknown as DbProvider), withAccount };
}
