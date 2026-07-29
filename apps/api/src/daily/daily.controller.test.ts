import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyController } from './daily.controller.js';
import type { DailyService } from './daily.service.js';

const response = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  facts: {
    steps: 0,
    runM: 0,
    bikeM: 0,
    swimM: 0,
    workoutPoints: 0,
    powerPoints: 0,
  },
  score: {
    appTotal: 0,
    excelTotal: null,
    delta: null,
    baseTotal: 0,
    bonusTotal: 0,
    ledgerTotal: 0,
  },
  sourceRecord: null,
  ledger: [],
};

describe('DailyController score breakdown', () => {
  let service: {
    summary: ReturnType<typeof vi.fn>;
    scoreBreakdown: ReturnType<typeof vi.fn>;
  };
  let controller: DailyController;

  beforeEach(() => {
    service = {
      summary: vi.fn(),
      scoreBreakdown: vi.fn(),
    };
    controller = new DailyController(service as unknown as DailyService);
  });

  it('returns the stable persisted score response for a valid date', async () => {
    service.scoreBreakdown.mockResolvedValue(response);

    await expect(controller.scoreBreakdown('2026-05-18')).resolves.toEqual(response);
    expect(service.scoreBreakdown).toHaveBeenCalledWith('2026-05-18');
  });

  it('rejects malformed and impossible calendar dates without querying the database', async () => {
    for (const date of ['18-05-2026', '2026-02-29']) {
      try {
        await controller.scoreBreakdown(date);
        throw new Error('Expected invalid date to throw.');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'INVALID_DATE',
          date,
        });
      }
    }
    expect(service.scoreBreakdown).not.toHaveBeenCalled();
  });

  it('returns an actionable not-found contract for a valid date with no persisted score', async () => {
    service.scoreBreakdown.mockResolvedValue(null);

    try {
      await controller.scoreBreakdown('2026-05-19');
      throw new Error('Expected missing date to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'DAILY_SCORE_NOT_FOUND',
        message: 'No persisted daily score exists for 2026-05-19.',
        date: '2026-05-19',
      });
    }
  });
});
