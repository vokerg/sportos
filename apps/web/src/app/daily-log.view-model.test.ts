import { describe, expect, it } from 'vitest';
import type { DailySummaryRow } from './api.service';
import { formatDate } from './date-time';
import {
  dailyLogChartOptions,
  dailyScoreStatusLabel,
  formatDailyCellNumber,
  formatDailyMeters,
  quickRangeDates,
} from './daily-log.view-model';

const row: DailySummaryRow = {
  metric_date: '2026-05-18',
  steps: 12_345,
  run_m: 5_000,
  bike_m: 0,
  swim_m: 0,
  workout_points: 0,
  power_points: 0,
  base_points: 20,
  bonus_points: 5,
  total_points: 25,
  excel_all_points: 24,
  points_delta_vs_excel: 1,
  avg_10d: 20,
  avg_20d: 19,
  avg_30d: 18,
  avg_60d: 17,
  avg_365d: 16,
  score_status: 'calculated',
};

describe('daily log view model', () => {
  it('derives calendar-aware quick ranges without changing all-time semantics', () => {
    const today = new Date('2026-03-31T12:00:00.000Z');

    expect(quickRangeDates('1m', today)).toEqual({ from: '2026-02-28', to: '2026-03-31' });
    expect(quickRangeDates('ytd', today)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(quickRangeDates('all', today)).toEqual({ from: '', to: '' });
  });

  it('builds the trend from every selected row in chronological order', () => {
    const rows = Array.from({ length: 121 }, (_, index) => ({
      ...row,
      metric_date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      total_points: index,
      avg_30d: index / 2,
    })).reverse();

    const options = dailyLogChartOptions(rows);
    const xAxis = options.xAxis as { data?: string[] };
    const series = options.series as Array<{ data?: number[] }>;

    expect(xAxis.data).toHaveLength(121);
    expect(xAxis.data?.[0]).toBe(formatDate(rows[120]!.metric_date));
    expect(xAxis.data?.at(-1)).toBe(formatDate(rows[0]!.metric_date));
    expect(series[0]?.data).toHaveLength(121);
    expect(series[1]?.data).toHaveLength(121);
  });

  it('keeps table formatting and authority labels explicit', () => {
    expect(formatDailyCellNumber(null)).toBe('—');
    expect(formatDailyCellNumber(1234.56)).toBe('1,234.56');
    expect(formatDailyMeters(5_000)).toBe('5 km');
    expect(formatDailyMeters(750, 0)).toBe('1 km');
    expect(dailyScoreStatusLabel('imported')).toBe('Imported ledger');
    expect(dailyScoreStatusLabel('manual')).toBe('Manual edit');
    expect(dailyScoreStatusLabel('calculated')).toBe('Calculated');
  });
});
