import { describe, expect, it } from 'vitest';
import type { DynamicsDailyRow, ScoreContributionRow } from '@sportos/db';
import { buildDynamicsResponse, buildRollingDynamicsResponse, rollingLookbackFrom } from './dynamics.contracts.js';

const rows: DynamicsDailyRow[] = [
  { metricDate: '2026-01-31', score: 100, steps: 1_000, run: 5_000, bike: 0, swim: 0, workout: 10, bonus: 0 },
  { metricDate: '2026-02-02', score: 300, steps: 3_000, run: 0, bike: 20_000, swim: 500, workout: 0, bonus: 20 },
];

describe('buildDynamicsResponse', () => {
  it('builds monthly totals, recorded-day averages, coverage, and partial markers', () => {
    const result = buildDynamicsResponse(rows, {
      from: '2026-01-30', to: '2026-02-03', granularity: 'daily', metrics: ['score', 'run'],
    });

    expect(result.monthly).toEqual([
      expect.objectContaining({
        key: '2026-01', calendarDays: 2, recordedDays: 1, partial: true,
        values: { score: { total: 100, recordedDayAverage: 100 }, run: { total: 5_000, recordedDayAverage: 5_000 } },
      }),
      expect.objectContaining({
        key: '2026-02', calendarDays: 3, recordedDays: 1, partial: true,
        values: { score: { total: 300, recordedDayAverage: 300 }, run: { total: 0, recordedDayAverage: 0 } },
      }),
    ]);
    expect(result.series).toHaveLength(5);
    expect(result.series[0]).toMatchObject({ key: '2026-01-30', recordedDays: 0, values: { score: { total: null } } });
    expect(result.series[2]).toMatchObject({ key: '2026-02-01', recordedDays: 0, values: { run: { total: null } } });
  });

  it('adds monthly score-ledger components while keeping Sum on the official score total', () => {
    const result = buildDynamicsResponse(rows, {
      from: '2026-01-01', to: '2026-02-28', granularity: 'monthly', metrics: ['run'],
    }, [
      { metricDate: '2026-01-31', activityType: 'bike', points: 346 },
      { metricDate: '2026-01-31', activityType: 'run', points: 206 },
      { metricDate: '2026-01-31', activityType: 'steps', points: 160 },
      { metricDate: '2026-02-02', activityType: 'bonus', points: 20 },
    ]);

    expect(result.monthly[0]).toMatchObject({
      values: { score: { total: 100 } },
      scoreContributions: { bike: 346, run: 206, steps: 160 },
    });
    expect(result.monthly[1]?.scoreContributions).toEqual({ bonus: 20 });
    expect(result.monthly[0]?.distanceTotals).toEqual({ run: 5_000, bike: 0, swim: 0 });
    expect(result.monthly[1]?.distanceTotals).toEqual({ run: 0, bike: 20_000, swim: 500 });
    expect(result.metrics).toEqual(['run']);
  });

  it('uses ISO Monday week buckets without treating absent days as zero', () => {
    const result = buildDynamicsResponse(rows, {
      from: '2026-01-31', to: '2026-02-03', granularity: 'weekly', metrics: ['steps'],
    });

    expect(result.series).toEqual([
      expect.objectContaining({ key: '2026-01-26', from: '2026-01-31', to: '2026-02-01', calendarDays: 2, recordedDays: 1, partial: true }),
      expect.objectContaining({ key: '2026-02-02', from: '2026-02-02', to: '2026-02-03', calendarDays: 2, recordedDays: 1, partial: true }),
    ]);
  });
});

describe('buildRollingDynamicsResponse', () => {
  it('emits one point per calendar day and drops values on the exact expiry date', () => {
    const rollingRows: DynamicsDailyRow[] = [
      { metricDate: '2026-01-01', score: 0, steps: 0, run: 42_195, bike: 0, swim: 0, workout: 0, bonus: 0 },
      { metricDate: '2026-01-30', score: 0, steps: 0, run: 0, bike: 0, swim: 0, workout: 0, bonus: 0 },
      { metricDate: '2026-01-31', score: 0, steps: 0, run: 0, bike: 0, swim: 0, workout: 0, bonus: 0 },
    ];
    const contributionRows: ScoreContributionRow[] = [
      { metricDate: '2026-01-01', activityType: 'run', points: 300 },
      { metricDate: '2026-01-01', activityType: 'steps', points: 60 },
      { metricDate: '2026-01-31', activityType: 'bonus', points: 30 },
    ];
    const result = buildRollingDynamicsResponse(rollingRows, {
      from: '2026-01-30', to: '2026-01-31', metric: 'run', windows: [30, 365],
    }, contributionRows);

    expect(result.points).toHaveLength(2);
    expect(result.points[0]?.windows[30]).toMatchObject({ total: 42_195, calendarDayAverage: 1_406.5, activeDays: 1, recordedDays: 2, windowDays: 30, complete: false });
    expect(result.points[1]?.windows[30]).toMatchObject({ total: 0, calendarDayAverage: 0, activeDays: 0, recordedDays: 2, windowDays: 30, complete: false });
    expect(result.points[1]?.dailyValue).toBe(0);
    expect(result.scoreContributions[30]?.categories).toEqual(['steps', 'run', 'bonus']);
    expect(result.scoreContributions[30]?.points).toEqual([
      { date: '2026-01-30', contributions: { steps: 2, run: 10, bonus: 0 }, total: 12 },
      { date: '2026-01-31', contributions: { steps: 0, run: 0, bonus: 1 }, total: 1 },
    ]);
    expect(result.scoreContributions[365]?.points[0]).toEqual({
      date: '2026-01-30', contributions: { steps: 0.1643835616438356, run: 0.821917808219178, bonus: 0 }, total: 0.9863013698630136,
    });
  });

  it('requests enough history for the largest selected window', () => {
    expect(rollingLookbackFrom('2026-12-31', [30, 365])).toBe('2026-01-01');
  });
});
