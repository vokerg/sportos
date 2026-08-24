import { describe, expect, it } from 'vitest';
import { isIsoDate, parseDailyScoreBreakdown, ScoreBreakdownContractError } from './score-breakdown-contract.js';
import type { DailyScoreBreakdownReadModel } from './repository-contracts.js';

const validResponse: DailyScoreBreakdownReadModel = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  facts: {
    steps: 12_345,
    runM: 13_000,
    bikeM: 35_000,
    swimM: 1_000,
    workoutPoints: 8,
    powerPoints: 7,
  },
  score: {
    appTotal: 25,
    excelTotal: 24,
    delta: 1,
    baseTotal: 20,
    bonusTotal: 5,
    ledgerTotal: 25,
  },
  sourceRecord: null,
  activities: [],
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
});

describe('ISO date contract', () => {
  it('accepts real calendar dates and rejects impossible dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('18-05-2026')).toBe(false);
  });
});
