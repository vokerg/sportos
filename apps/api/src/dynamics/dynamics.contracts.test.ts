import { describe, expect, it } from 'vitest';
import type { DynamicsDailyRow } from '@sportos/db';
import { buildDynamicsResponse } from './dynamics.contracts.js';

const rows: DynamicsDailyRow[] = [
  { metricDate: '2026-01-31', score: 100, steps: 1_000, run: 5_000, bike: 0, swim: 0, workout: 10, power: 0 },
  { metricDate: '2026-02-02', score: 300, steps: 3_000, run: 0, bike: 20_000, swim: 500, workout: 0, power: 20 },
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
