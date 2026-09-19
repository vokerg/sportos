import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DailyRecalculationUnavailableError, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyController } from './daily.controller.js';
import type { DailyService } from './daily.service.js';

const response = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  scoreStatus: 'calculated',
  facts: { steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0 },
  score: { appTotal: 0, excelTotal: null, delta: null, baseTotal: 0, bonusPoints: 0, ledgerTotal: 0 },
  sourceRecord: null,
  activities: [],
  garminObservations: [],
  sourceRecords: [],
  ledger: [],
};

describe('DailyController cockpit contracts', () => {
  let service: { summary: ReturnType<typeof vi.fn>; manualFacts: ReturnType<typeof vi.fn>; evidence: ReturnType<typeof vi.fn>; scoreBreakdown: ReturnType<typeof vi.fn>; recalculateFromActivities: ReturnType<typeof vi.fn>; saveManualFacts: ReturnType<typeof vi.fn>; runningStepEstimate: ReturnType<typeof vi.fn> };
  let controller: DailyController;

  beforeEach(() => {
    service = { summary: vi.fn(), manualFacts: vi.fn(), evidence: vi.fn(), scoreBreakdown: vi.fn(), recalculateFromActivities: vi.fn(), saveManualFacts: vi.fn(), runningStepEstimate: vi.fn() };
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
    await expect(controller.summary(undefined, undefined, '10001')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.summary).not.toHaveBeenCalled();
  });

  it('lists bounded owner-scoped facts for quick entry', async () => {
    service.manualFacts.mockResolvedValue([]);
    await expect(controller.manualFacts('2026-05-01', '2026-05-31', '100')).resolves.toEqual([]);
    expect(service.manualFacts).toHaveBeenCalledWith(
      { from: '2026-05-01', to: '2026-05-31', limit: 100 },
      LEGACY_ACCOUNT_ID,
    );
  });

  it('returns the stable persisted score response for a valid date', async () => {
    service.scoreBreakdown.mockResolvedValue(response);
    await expect(controller.scoreBreakdown('2026-05-18')).resolves.toEqual(response);
    expect(service.scoreBreakdown).toHaveBeenCalledWith('2026-05-18', LEGACY_ACCOUNT_ID);
  });

  it('returns dated evidence even when no score row exists', async () => {
    const evidence = { date: '2026-05-18', garminObservations: [], sourceRecords: [] };
    service.evidence.mockResolvedValue(evidence);

    await expect(controller.evidence('2026-05-18')).resolves.toEqual(evidence);
    expect(service.evidence).toHaveBeenCalledWith('2026-05-18', LEGACY_ACCOUNT_ID);
    expect(() => controller.evidence('2026-02-29')).toThrow(BadRequestException);
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

  it('saves a complete manual fact set in the authenticated account context', async () => {
    const input = {
      steps: 1000, runIndoorM: 1000, runOutdoorM: 3000,
      runUnspecifiedM: 1000, bikeIndoorM: 500, bikeOutdoorM: 1000, bikeUnspecifiedM: 500, swimM: 750,
      workoutPoints: 10, bonusPoints: 5,
    };
    service.saveManualFacts.mockResolvedValue({ ...response, scoreStatus: 'manual' });

    await expect(controller.saveManualFacts('2026-05-18', input)).resolves.toMatchObject({ scoreStatus: 'manual' });
    expect(service.saveManualFacts).toHaveBeenCalledWith('2026-05-18', input, LEGACY_ACCOUNT_ID);
  });

  it('validates all-day steps and scopes the run estimate to the selected date', async () => {
    const input = {
      steps: 5000, totalSteps: 8000, runIndoorM: 0, runOutdoorM: 5000,
      runUnspecifiedM: 0, bikeIndoorM: 0, bikeOutdoorM: 0, bikeUnspecifiedM: 0,
      swimM: 0, workoutPoints: 0, bonusPoints: 0,
    };
    await controller.saveManualFacts('2026-05-18', input);
    expect(service.saveManualFacts).toHaveBeenCalledWith('2026-05-18', input, LEGACY_ACCOUNT_ID);

    service.runningStepEstimate.mockResolvedValue({ estimatedRunningSteps: 3000 });
    await expect(controller.runningStepEstimate('2026-05-18')).resolves.toEqual({ estimatedRunningSteps: 3000 });
    expect(service.runningStepEstimate).toHaveBeenCalledWith('2026-05-18', LEGACY_ACCOUNT_ID);
    expect(() => controller.runningStepEstimate('2026-02-29')).toThrow(BadRequestException);
    await expect(controller.saveManualFacts('2026-05-18', { ...input, totalSteps: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects incomplete, unknown, and fractional integer manual facts', async () => {
    const valid = {
      steps: 1000, runIndoorM: 1000, runOutdoorM: 3000,
      runUnspecifiedM: 1000, bikeIndoorM: 500, bikeOutdoorM: 1000, bikeUnspecifiedM: 500, swimM: 750,
      workoutPoints: 10, bonusPoints: 5,
    };
    for (const input of [
      { ...valid, bonusPoints: undefined },
      { ...valid, ownerId: 'foreign' },
      { ...valid, steps: 1.5 },
      { ...valid, runM: 5000 },
    ]) {
      await expect(controller.saveManualFacts('2026-05-18', input)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(service.saveManualFacts).not.toHaveBeenCalled();
  });
});
