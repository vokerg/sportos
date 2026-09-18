import { describe, expect, it } from 'vitest';
import { importedScoreContributionRows, scoreContributionActivityType } from './dynamics.repository.js';

describe('importedScoreContributionRows', () => {
  it('maps retained workbook ledger components to activity contribution rows', () => {
    const rows = importedScoreContributionRows('2026-05-18', 6_000, {
      headers: ['Date', 'Steps', 'Run to S', 'Bike to S', 'SUP to S', 'raw to s', 'Swim to S', 'WOtotal', 'Pow', 'All'],
      cells: [46_160, 1_000, 2_000, 2_500, 100, 150, 200, 45, 5, 6_000],
    });

    expect(rows).toEqual([
      { metricDate: '2026-05-18', activityType: 'steps', points: 1_000 },
      { metricDate: '2026-05-18', activityType: 'run', points: 2_000 },
      { metricDate: '2026-05-18', activityType: 'bike', points: 2_500 },
      { metricDate: '2026-05-18', activityType: 'sup', points: 100 },
      { metricDate: '2026-05-18', activityType: 'rowing', points: 150 },
      { metricDate: '2026-05-18', activityType: 'swim', points: 200 },
      { metricDate: '2026-05-18', activityType: 'workout', points: 45 },
      { metricDate: '2026-05-18', activityType: 'bonus', points: 5 },
    ]);
  });

  it('refuses to guess when retained components do not equal the official total', () => {
    expect(() => importedScoreContributionRows('2026-05-18', 100, {
      headers: ['Steps', 'All'], cells: [90, 100],
    })).toThrow('do not match');
  });
});

describe('scoreContributionActivityType', () => {
  it('puts achievement points in Bonus while retaining base activity attribution', () => {
    expect(scoreContributionActivityType('achievement', 'bike', 'bike')).toBe('bonus');
    expect(scoreContributionActivityType('coefficient', 'bike', 'bike')).toBe('bike');
    expect(scoreContributionActivityType('manual_points', 'bonus', null)).toBe('bonus');
  });
});
