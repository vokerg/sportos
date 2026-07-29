import { describe, expect, it } from 'vitest';
import { DailyScoreBreakdownSchema, IsoDateSchema } from './score-breakdown.js';

const validResponse = {
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

describe('daily score breakdown contract', () => {
  it('accepts a consistent persisted score explanation', () => {
    expect(DailyScoreBreakdownSchema.parse(validResponse)).toEqual(validResponse);
  });

  it('rejects inconsistent ledger and subtotal values', () => {
    const result = DailyScoreBreakdownSchema.safeParse({
      ...validResponse,
      score: { ...validResponse.score, appTotal: 26 },
    });
    expect(result.success).toBe(false);
  });

  it('requires null delta when the spreadsheet total is absent', () => {
    expect(
      DailyScoreBreakdownSchema.parse({
        ...validResponse,
        score: { ...validResponse.score, excelTotal: null, delta: null },
      }).score.delta,
    ).toBeNull();
  });
});

describe('ISO date contract', () => {
  it('accepts real calendar dates and rejects impossible dates', () => {
    expect(IsoDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(IsoDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(IsoDateSchema.safeParse('18-05-2026').success).toBe(false);
  });
});
