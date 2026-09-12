import { describe, expect, it } from 'vitest';
import type { DailyScoreBreakdown } from './score-breakdown.models';
import {
  deltaDescription,
  deltaKind,
  deltaValue,
  formatDistance,
  formatNumber,
  formatSigned,
  ledgerMatchesAppTotal,
  ledgerSum,
  scoreAuthorityNote,
  scoreStatusLabel,
} from './score-breakdown.view-model';

const breakdown: DailyScoreBreakdown = {
  date: '2026-09-12',
  recomputedAt: '2026-09-12T10:00:00.000Z',
  scoreStatus: 'calculated',
  facts: { steps: 1234, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 25, excelTotal: 24, delta: 1, baseTotal: 20, bonusTotal: 5, ledgerTotal: 25 },
  sourceRecord: null,
  activities: [],
  sourceRecords: [],
  ledger: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      points: 20,
      reason: 'Base',
      calculation: {},
      createdAt: '2026-09-12T10:00:00.000Z',
      rule: null,
      activity: null,
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      points: 5,
      reason: 'Bonus',
      calculation: {},
      createdAt: '2026-09-12T10:00:01.000Z',
      rule: null,
      activity: null,
    },
  ],
};

describe('score breakdown view model', () => {
  it('derives delta presentation without changing score values', () => {
    expect([1, -1, 0, null].map(deltaKind)).toEqual(['positive', 'negative', 'zero', 'unavailable']);
    expect(deltaValue(4)).toBe('+4');
    expect(deltaValue(-4)).toBe('−4');
    expect(deltaValue(0)).toBe('0');
    expect(deltaValue(null)).toBe('Not available');
    expect(deltaDescription(null)).toBe('No spreadsheet total was imported');
  });

  it('describes score authority states explicitly', () => {
    expect(scoreStatusLabel('imported')).toBe('Imported ledger');
    expect(scoreStatusLabel('manual')).toBe('Manual edit');
    expect(scoreStatusLabel('calculated')).toBe('Calculated');
    expect(scoreAuthorityNote('imported')).toContain('authoritative');
    expect(scoreAuthorityNote('manual')).toContain('authoritative');
    expect(scoreAuthorityNote('calculated')).toContain('canonical activities');
  });

  it('formats display values and checks persisted ledger consistency', () => {
    expect(formatNumber(1234.5)).toBe('1,234.5');
    expect(formatDistance(5000)).toBe('5 km');
    expect(formatDistance(null)).toBe('—');
    expect(formatSigned(5)).toBe('+5');
    expect(formatSigned(-5)).toBe('−5');
    expect(ledgerSum(breakdown)).toBe(25);
    expect(ledgerMatchesAppTotal(breakdown)).toBe(true);
    expect(ledgerMatchesAppTotal({ ...breakdown, score: { ...breakdown.score, appTotal: 26 } })).toBe(false);
  });
});
