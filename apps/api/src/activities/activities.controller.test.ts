import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivitiesRepository, type Database, type Kysely } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import type { ActivityProviderDetailService } from './activity-provider-detail.service.js';
import { ActivitiesController, parseActivitiesQuery } from './activities.controller.js';

const id = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const account = { id: accountId } as never;

describe('ActivitiesController', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists with bounded defaults and validated type, date, and source filters in account context', async () => {
    const list = vi.spyOn(ActivitiesRepository.prototype, 'list').mockResolvedValue({ items: [], summary: { count: 0, durationS: 0, distanceM: 0, avgDistanceM: null, avgPaceSPerKm: null }, limit: 50, offset: 0 });
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
      { activityType: 'run', minAvgSpeedMps: '5' },
      { activityType: 'bike', paceUnderSPerKm: '252' },
      { activityType: 'swim', swimPaceUnderSPer100m: 'Infinity' },
      { minDistanceM: '5000' },
      { activityType: 'bike', subtype: 'outdoor' },
      { activityType: 'run', subtype: 'indoor' },
    ]) expect(() => parseActivitiesQuery(query)).toThrow(BadRequestException);
  });

  it('accepts bounded canonical sport filters only with their matching type', () => {
    expect(parseActivitiesQuery({ activityType: 'run', minDistanceM: '5000', paceUnderSPerKm: '252' }))
      .toMatchObject({ activityType: 'run', minDistanceM: 5000, paceUnderSPerKm: 252 });
    expect(parseActivitiesQuery({ activityType: 'run', subtype: 'track' }))
      .toMatchObject({ activityType: 'run', subtype: 'track' });
    expect(parseActivitiesQuery({ activityType: 'bike', minDistanceM: '20000', minAvgSpeedMps: '6.25' }))
      .toMatchObject({ activityType: 'bike', minDistanceM: 20000, minAvgSpeedMps: 6.25 });
    expect(parseActivitiesQuery({ activityType: 'swim', swimPaceUnderSPer100m: '120' }))
      .toMatchObject({ activityType: 'swim', swimPaceUnderSPer100m: 120 });
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

  it('loads full provider detail through the authenticated account', async () => {
    const { controller, providerDetailService } = createController();
    providerDetailService.load.mockResolvedValue({ provider: 'strava', providerActivityId: '20223486250' } as never);
    await expect(controller.providerDetail(id, account)).resolves.toMatchObject({ provider: 'strava' });
    expect(providerDetailService.load).toHaveBeenCalledWith(accountId, id);
  });

  it('reads retained source JSON only through account context and hides missing or foreign records', async () => {
    const source = { sourceRecordId: id, sourceRecordSource: 'strava_api', rawJson: { average_cadence: 88 } };
    const getSourceJson = vi.spyOn(ActivitiesRepository.prototype, 'getSourceJson').mockResolvedValueOnce(source).mockResolvedValue(null);
    const { controller, withAccount } = createController();
    await expect(controller.sourceJson(id, account)).resolves.toEqual(source);
    await expect(controller.sourceJson(id, account)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.sourceJson(id, account)).rejects.toBeInstanceOf(NotFoundException);
    expect(getSourceJson).toHaveBeenCalledWith(id);
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
  });
});

function createController() {
  const scopedDb = {} as Kysely<Database>;
  const withAccount = vi.fn(async <T>(_accountId: string, callback: (db: Kysely<Database>) => Promise<T>) => callback(scopedDb));
  const providerDetailService = { load: vi.fn() };
  return {
    controller: new ActivitiesController(
      { withAccount } as unknown as DbProvider,
      providerDetailService as unknown as ActivityProviderDetailService,
    ),
    withAccount,
    providerDetailService,
  };
}
