import { describe, expect, it, vi } from 'vitest';
import type { DailySummaryRow } from './features/daily/model/daily.models';
import { formatDate } from './date-time';
import {
  dailyLogChartOptions,
  dailyLogLegendItems,
  dailyLogRowAtChartIndex,
  dailyScoreStatusLabel,
  compareDailyNumbers,
  formatDailyCellNumber,
  formatDailyMeters,
  positiveMetricRange,
  quickRangeDates,
  relativePastelBackground,
} from './daily-log.view-model';

const row: DailySummaryRow = {
  metric_date: '2026-05-18',
  steps: 12_345,
  run_m: 5_000,
  bike_m: 0,
  swim_m: 0,
  workout_points: 0,
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
    expect(xAxis.data?.[120]).toBe(formatDate(rows[0]!.metric_date));
    expect(series[0]?.data).toHaveLength(121);
    expect(series[1]?.data).toHaveLength(121);
    expect(dailyLogRowAtChartIndex(rows, 0)?.metric_date).toBe(rows[120]!.metric_date);
    expect(dailyLogRowAtChartIndex(rows, 120)?.metric_date).toBe(rows[0]!.metric_date);
    expect(dailyLogRowAtChartIndex(rows, -1)).toBeUndefined();
  });

  it('uses a readable recent window on narrow screens without changing the selected range', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 23, 12));
    try {
      const rows = Array.from({ length: 30 }, (_, index) => ({
        ...row,
        metric_date: new Date(Date.UTC(2026, 9, 25 + index)).toISOString().slice(0, 10),
        total_points: index + 100,
      })).reverse();

      const compact = dailyLogChartOptions(rows, { windowDays: 14, compact: true }) as Record<string, any>;
      expect(compact.xAxis.data).toHaveLength(14);
      expect(compact.xAxis.axisLabel.interval).toBe(3);
      expect(compact.legend.show).toBe(false);
      expect(compact.yAxis.name).toBeUndefined();
      expect(compact.yAxis.axisLabel.formatter(80_000)).toBe('80k');
      expect(compact.xAxis.axisLabel.formatter(compact.xAxis.data.at(-1), 13)).toContain('Today*');
      expect(compact.series[0].data).toHaveLength(14);
      expect(dailyLogRowAtChartIndex(rows, 0, 14)?.metric_date).toBe('2026-11-10');
      expect(dailyLogRowAtChartIndex(rows, 13, 14)?.metric_date).toBe('2026-11-23');
      expect(dailyLogRowAtChartIndex(rows, 14, 14)).toBeUndefined();
      expect(dailyLogLegendItems(rows, 14).map(item => item.label)).toEqual(['Unattributed', '30d avg']);

      const month = dailyLogChartOptions(rows, { windowDays: 30, compact: true }) as Record<string, any>;
      expect(month.xAxis.data).toHaveLength(30);
      const full = dailyLogChartOptions(rows) as Record<string, any>;
      expect(full.xAxis.data).toHaveLength(30);
      expect(full.legend.type).toBe('scroll');
      expect(full.yAxis.name).toBe('Points');
      expect(rows).toHaveLength(30);
    } finally { vi.useRealTimers(); }
  });

  it('anchors the mobile window to the selected range when viewing historical dates', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      ...row,
      metric_date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    })).reverse();
    const options = dailyLogChartOptions(rows, { windowDays: 14, compact: true }) as Record<string, any>;
    expect(options.xAxis.data).toHaveLength(14);
    expect(dailyLogRowAtChartIndex(rows, 0, 14)?.metric_date).toBe('2026-01-17');
    expect(dailyLogRowAtChartIndex(rows, 13, 14)?.metric_date).toBe('2026-01-30');
  });

  it('includes and labels today in every series and bar navigation, excluding future days', () => {
    vi.useFakeTimers();
    // Local midnight is deliberate: the cutoff must follow the browser day.
    vi.setSystemTime(new Date(2026, 0, 31, 0, 15));
    try {
      const rows = ['2026-02-01', '2026-01-31', '2026-01-30', '2026-01-29']
        .map((metric_date, index) => ({ ...row, metric_date, total_points: index, avg_30d: index * 10 }));
      const options = dailyLogChartOptions(rows) as Record<string, any>;
      expect(options.xAxis.data).toEqual([
        formatDate('2026-01-29'), formatDate('2026-01-30'), `${formatDate('2026-01-31')} (Incomplete)`,
      ]);
      expect(options.xAxis.axisLabel).toMatchObject({ showMaxLabel: true, alignMaxLabel: 'right' });
      expect(options.xAxis.axisLabel.formatter(options.xAxis.data.at(-1))).toBe(`${formatDate('2026-01-31')}\nIncomplete`);
      expect(options.series.map((series: any) => series.data)).toEqual([[3, 2, 1], [30, 20, 10]]);
      expect(Array.isArray(options.yAxis)).toBe(false);
      expect(options.series.filter((series: any) => series.type === 'line').map((series: any) => series.name)).toEqual(['30d average']);
      expect(options.series.every((series: any) => series.yAxisIndex === 0)).toBe(true);
      expect(dailyLogRowAtChartIndex(rows, 0)?.metric_date).toBe('2026-01-29');
      expect(dailyLogRowAtChartIndex(rows, 1)?.metric_date).toBe('2026-01-30');
      expect(dailyLogRowAtChartIndex(rows, 2)?.metric_date).toBe('2026-01-31');
      expect(dailyLogRowAtChartIndex(rows, 3)).toBeUndefined();
      expect(rows).toHaveLength(4);
      const todayOnly = rows.slice(1, 2);
      expect((dailyLogChartOptions(todayOnly).xAxis as { data: string[] }).data).toEqual([`${formatDate('2026-01-31')} (Incomplete)`]);
      expect(dailyLogRowAtChartIndex(todayOnly, 0)?.metric_date).toBe('2026-01-31');
      const futureOnly = rows.slice(0, 1);
      expect((dailyLogChartOptions(futureOnly).xAxis as { data: string[] }).data).toEqual([]);
      expect(dailyLogRowAtChartIndex(futureOnly, 0)).toBeUndefined();
      const historicalOnly = rows.slice(2);
      expect((dailyLogChartOptions(historicalOnly).xAxis as { data: string[] }).data).toEqual([
        formatDate('2026-01-29'), formatDate('2026-01-30'),
      ]);

      vi.setSystemTime(new Date(2026, 1, 1, 0, 15));
      expect((dailyLogChartOptions(todayOnly).xAxis as { data: string[] }).data).toEqual([formatDate('2026-01-31')]);
    } finally { vi.useRealTimers(); }
  });

  it('keeps table formatting and authority labels explicit', () => {
    expect(formatDailyCellNumber(null)).toBe('—');
    expect(formatDailyCellNumber(1234.56)).toBe('1,234.56');
    expect(formatDailyMeters(5_000)).toBe('5 km');
    expect(formatDailyMeters(750, 0)).toBe('1 km');
    expect(dailyScoreStatusLabel('imported')).toBe('Imported ledger');
    expect(dailyScoreStatusLabel('manual')).toBe('Manual edit');
    expect(dailyScoreStatusLabel('calculated')).toBe('Calculated');
    expect(compareDailyNumbers('9.95', '26.9')).toBeLessThan(0);
    expect(compareDailyNumbers('10000', 9_000)).toBeGreaterThan(0);
  });

  it('maps positive values to a restrained relative pastel scale', () => {
    const range = positiveMetricRange([0, 5_000, 21_000, null, Number.NaN]);

    expect(range).toEqual({ min: 5_000, max: 21_000, mean: 13_000 });
    expect(relativePastelBackground(0, range, '116, 168, 132')).toBeUndefined();
    expect(relativePastelBackground(5_000, range, '116, 168, 132')).toBe('rgba(116, 168, 132, 0.15)');
    expect(relativePastelBackground(21_000, range, '116, 168, 132')).toBe('rgba(116, 168, 132, 0.54)');
  });

  it('uses a middle pastel tone when the selection has one positive value', () => {
    const range = positiveMetricRange([0, 5_000]);

    expect(relativePastelBackground(5_000, range, '116, 168, 132')).toBe('rgba(116, 168, 132, 0.30)');
    expect(positiveMetricRange([0, null, Number.NaN])).toBeNull();
  });
});
