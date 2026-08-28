import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DailyRecalculationUnavailableError, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyController } from './daily.controller.js';
import type { DailyService } from './daily.service.js';

const response = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  scoreStatus: 'calculated',
  facts: { steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 0, excelTotal: null, delta: null, baseTotal: 0, bonusTotal: 0, ledgerTotal: 0 },
  sourceRecord: null,
  activities: [],
  sourceRecords: [],
  ledger: [],
};

describe('DailyController cockpit contracts', () => {
  let service: { summary: ReturnType<typeof vi.fn>; scoreBreakdown: ReturnType<typeof vi.fn>; recalculateFromActivities: ReturnType<typeof vi.fn> };
  let controller: DailyController;

  beforeEach(() => {
    service = { summary: vi.fn(), scoreBreakdown: vi.fn(), recalculateFromActivities: vi.fn() };
    controller = new DailyController(service as unknown as DailyService);
  });

  it('passes a validated inclusive summary range and owner context', async () => {
    service.summary.mockResolvedValue([]);
    await expect(controller.summary('2026-05-01', '2026-05-31', '250')).resolves.toEqual([]);
    expect(service.summary).toHaveBeenCalledWith(
      { from: '2026-05-01', to: '2026-05-31', limit: 250 },
      LEGACY_ACCOUNT_ID,
    );
  });

  it('rejects impossible, reversed, and unbounded summary filters before querying', async () => {
    await expect(controller.summary('2026-02-30', '2026-05-31', '250')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.summary('2026-06-01', '2026-05-31', '250')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.summary(undefined, undefined, '0')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.summary).not.toHaveBeenCalled();
  });

  it('returns the stable persisted score response for a valid date', async () => {
    service.scoreBreakdown.mockResolvedValue(response);
    await expect(controller.scoreBreakdown('2026-05-18')).resolves.toEqual(response);
    expect(service.scoreBreakdown).toHaveBeenCalledWith('2026-05-18', LEGACY_ACCOUNT_ID);
  });

  it('rejects malformed and impossible calendar dates without querying the database', async () => {
    for (const date of ['18-05-2026', '2026-02-29']) {
      await expect(controller.scoreBreakdown(date)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(service.scoreBreakdown).not.toHaveBeenCalled();
  });

  it('returns a non-enumerating not-found contract for a missing or foreign score', async () => {
    service.scoreBreakdown.mockResolvedValue(null);
    try {
      await controller.scoreBreakdown('2026-05-19');
      throw new Error('Expected missing date to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'DAILY_SCORE_NOT_FOUND',
        message: 'No persisted daily score exists for the selected date.',
        date: '2026-05-19',
      });
    }
  });

  it('recalculates a valid date in the authenticated account context', async () => {
    service.recalculateFromActivities.mockResolvedValue(response);
    await expect(controller.recalculate('2026-05-18')).resolves.toEqual(response);
    expect(service.recalculateFromActivities).toHaveBeenCalledWith('2026-05-18', LEGACY_ACCOUNT_ID);
  });

  it('returns a bounded conflict when no Strava activity exists for recalculation', async () => {
    service.recalculateFromActivities.mockRejectedValue(new DailyRecalculationUnavailableError('2026-05-19'));
    await expect(controller.recalculate('2026-05-19')).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'STRAVA_DATA_UNAVAILABLE',
        date: '2026-05-19',
      },
    });
  });

  it('rejects an invalid recalculation date before querying the service', async () => {
    await expect(controller.recalculate('2026-02-29')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.recalculateFromActivities).not.toHaveBeenCalled();
  });
});
