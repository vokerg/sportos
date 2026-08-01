import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PerformanceRepository } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import { PerformanceController } from './performance.controller.js';

const eventId = '11111111-1111-4111-8111-111111111111';

describe('PerformanceController', () => {
  afterEach(() => vi.restoreAllMocks());

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
    await expect(controller.events('5000', '2026-02-30', '2026-03-01', '100')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.events('5000', undefined, undefined, '501')).rejects.toBeInstanceOf(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it('returns event provenance and a stable not-found contract', async () => {
    const detail = vi.spyOn(PerformanceRepository.prototype, 'getEventDetail')
      .mockResolvedValueOnce({ id: eventId } as never)
      .mockResolvedValueOnce(null);
    const controller = createController();

    await expect(controller.event(eventId)).resolves.toMatchObject({ id: eventId });
    await expect(controller.event(eventId)).rejects.toBeInstanceOf(NotFoundException);
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed event ids without querying', async () => {
    const detail = vi.spyOn(PerformanceRepository.prototype, 'getEventDetail').mockResolvedValue(null);
    await expect(createController().event('not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    expect(detail).not.toHaveBeenCalled();
  });
});

function createController(): PerformanceController {
  return new PerformanceController({ db: {} } as unknown as DbProvider);
}
