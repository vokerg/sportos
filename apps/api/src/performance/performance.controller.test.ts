import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DistanceLeaderboardRepository, PerformanceRepository, type Database, type Kysely } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import { PerformanceController } from './performance.controller.js';

const eventId = '11111111-1111-4111-8111-111111111111';

describe('PerformanceController', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses a validated default for the legacy best-performance route', async () => {
    const best = vi.spyOn(PerformanceRepository.prototype, 'listBestByDistance').mockResolvedValue([]);
    const controller = createController();

    await expect(controller.best(undefined, undefined)).resolves.toEqual([]);
    expect(best).toHaveBeenCalledWith(5000, 25);
  });

  it('validates the unified target and bounded range before reading', async () => {
    const read=vi.spyOn(DistanceLeaderboardRepository.prototype,'read').mockResolvedValue({rows:[]} as never);
    const controller=createController();
    await controller.leaderboard('21097.5','2017-01-01','2026-10-17','200');
    expect(read).toHaveBeenCalledWith({distanceM:21097.5,from:'2017-01-01',to:'2026-10-17',limit:200,offset:0});
    await controller.leaderboard('5000',undefined,undefined,'50','250');
    expect(read).toHaveBeenLastCalledWith({distanceM:5000,from:undefined,to:undefined,limit:50,offset:250});
    read.mockClear();
    for(const distance of ['12000','-1',''])await expect(controller.leaderboard(distance)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.leaderboard('5000',undefined,undefined,'201')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.leaderboard('5000','2026-02-30')).rejects.toBeInstanceOf(BadRequestException);
    for(const offset of ['-1','1.5','abc','100001'])await expect(controller.leaderboard('5000',undefined,undefined,'100',offset)).rejects.toBeInstanceOf(BadRequestException);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an explicitly empty required distance with a stable code', async () => {
    const best = vi.spyOn(PerformanceRepository.prototype, 'listBestByDistance').mockResolvedValue([]);
    const controller = createController();

    try {
      await controller.best('', '25');
      throw new Error('Expected an empty distance to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'INVALID_DISTANCE_M' });
    }
    expect(best).not.toHaveBeenCalled();
  });

  it('passes validated distance, date, and limit filters', async () => {
    const list = vi.spyOn(PerformanceRepository.prototype, 'listEvents').mockResolvedValue([]);
    const controller = createController();

    await expect(controller.events('5000', '2026-01-01', '2026-12-31', '100')).resolves.toEqual([]);
    expect(list).toHaveBeenCalledWith({ distanceM: 5000, from: '2026-01-01', to: '2026-12-31', limit: 100 });
  });

  it('rejects invalid filters before repository execution', async () => {
    const list = vi.spyOn(PerformanceRepository.prototype, 'listEvents').mockResolvedValue([]);
    const controller = createController();

    await expect(controller.events('-1', undefined, undefined, '100')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.events('', undefined, undefined, '100')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.events('5000', '2026-02-30', '2026-03-01', '100')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.events('5000', undefined, undefined, '501')).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it('returns event provenance and a generic not-found contract', async () => {
    const detail = vi.spyOn(PerformanceRepository.prototype, 'getEventDetail')
      .mockResolvedValueOnce({ id: eventId } as never)
      .mockResolvedValueOnce(null);
    const controller = createController();

    await expect(controller.event(eventId)).resolves.toMatchObject({ id: eventId });
    try {
      await controller.event(eventId);
      throw new Error('Expected missing event to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'PERFORMANCE_EVENT_NOT_FOUND',
        message: 'Performance event was not found.',
      });
    }
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed event ids without querying', async () => {
    const detail = vi.spyOn(PerformanceRepository.prototype, 'getEventDetail').mockResolvedValue(null);
    await expect(createController().event('not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    expect(detail).not.toHaveBeenCalled();
  });
});

function createController(): PerformanceController {
  const scopedDb = {} as Kysely<Database>;
  return new PerformanceController({
    db: scopedDb,
    withAccount: async <T>(_accountId: string, callback: (db: Kysely<Database>) => Promise<T>) => callback(scopedDb),
  } as unknown as DbProvider);
}
