import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PerformanceRepository, type Database, type Kysely } from '@sportos/db';
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
