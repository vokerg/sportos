import { describe, expect, it } from 'vitest';
import { isIsoDate, parseDailyScoreBreakdown, ScoreBreakdownContractError } from './score-breakdown-contract.js';
import type { DailyScoreBreakdownReadModel } from './repository-contracts.js';

const validResponse: DailyScoreBreakdownReadModel = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  scoreStatus: 'calculated',
  facts: {
    steps: 12_345,
    runM: 13_000,
    bikeM: 35_000,
    swimM: 1_000,
    workoutPoints: 8,
  },
  score: {
    appTotal: 25,
    excelTotal: 24,
    delta: 1,
    baseTotal: 20,
    bonusPoints: 5,
    ledgerTotal: 25,
  },
  sourceRecord: null,
  activities: [],
  garminObservations: [],
  sourceRecords: [],
  ledger: [
    {
      id: '10000000-0000-4000-8000-000000000001',
      points: 20,
      reason: 'Daily coefficients',
      calculation: { metric: 'distance_km', value: 13 },
      createdAt: '2026-05-18T12:00:00.000Z',
      rule: null,
      activity: null,
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      points: 5,
      reason: 'Achievement bonus',
      calculation: { threshold: 1500 },
      createdAt: '2026-05-18T12:00:01.000Z',
      rule: null,
      activity: null,
    },
  ],
};

describe('daily score breakdown runtime contract', () => {
  it('accepts a consistent persisted score explanation', () => {
    expect(parseDailyScoreBreakdown(validResponse)).toBe(validResponse);
  });

  it('rejects inconsistent ledger and subtotal values', () => {
    expect(() =>
      parseDailyScoreBreakdown({
        ...validResponse,
        score: { ...validResponse.score, appTotal: 26 },
      }),
    ).toThrow(ScoreBreakdownContractError);
  });

  it('requires null delta when the spreadsheet total is absent', () => {
    expect(
      parseDailyScoreBreakdown({
        ...validResponse,
        score: { ...validResponse.score, excelTotal: null, delta: null },
      }).score.delta,
    ).toBeNull();
  });

  it('accepts a consistent Garmin running-step deduction and rejects a mismatched result', () => {
    const stepsCalculation = {
      source: 'garmin_adjusted' as const,
      resolvedSteps: 2_701,
      garminTotalSteps: 15_000,
      estimatedRunningSteps: 12_299,
      runs: [
        { movingTimeS: 2_400, cadenceSpm: 186, cadenceSource: 'strava_cadence' as const, estimatedSteps: 7_440 },
        { movingTimeS: 1_695, cadenceSpm: 172, cadenceSource: 'strava_cadence' as const, estimatedSteps: 4_859 },
      ],
      unestimatedRunCount: 0,
    };
    const response = {
      ...validResponse,
      facts: { ...validResponse.facts, steps: 2_701, stepsCalculation },
    };

    expect(parseDailyScoreBreakdown(response).facts.stepsCalculation).toEqual(stepsCalculation);
    expect(() => parseDailyScoreBreakdown({
      ...response,
      facts: { ...response.facts, stepsCalculation: { ...stepsCalculation, resolvedSteps: 2_700 } },
    })).toThrow(ScoreBreakdownContractError);
  });

  it('accepts dated Garmin evidence and rejects observations assigned to another day', () => {
    const sourceRecord = {
      id: '20000000-0000-4000-8000-000000000001',
      rowHash: 'garmin-row-hash',
      sheetName: 'steps_weekly',
      rowIndex: 2,
      status: 'normalized' as const,
      rawJson: { cells: ['18/05/2026', '12345'] },
      errors: [],
      warnings: [],
      normalizedEntityType: 'garmin_observation',
      normalizedEntityId: '30000000-0000-4000-8000-000000000001',
      batch: {
        id: '40000000-0000-4000-8000-000000000001',
        source: 'garmin_csv',
        filename: 'steps.csv',
        originalSha256: 'hash',
        status: 'normalized' as const,
        startedAt: '2026-05-18T12:00:00.000Z',
        completedAt: '2026-05-18T12:00:01.000Z',
      },
    };
    const observation = {
      id: '30000000-0000-4000-8000-000000000001',
      reportType: 'steps_weekly' as const,
      recordedDate: validResponse.date,
      recordedTime: null,
      values: { steps: 12345 },
      sourceRecord,
    };

    expect(parseDailyScoreBreakdown({
      ...validResponse,
      garminObservations: [observation],
      sourceRecords: [sourceRecord],
    }).garminObservations).toEqual([observation]);
    expect(() => parseDailyScoreBreakdown({
      ...validResponse,
      garminObservations: [{ ...observation, recordedDate: '2026-05-19' }],
      sourceRecords: [sourceRecord],
    })).toThrow(ScoreBreakdownContractError);
  });
});

describe('ISO date contract', () => {
  it('accepts real calendar dates and rejects impossible dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('18-05-2026')).toBe(false);
  });
});
