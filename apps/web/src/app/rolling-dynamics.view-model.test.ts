import { describe, expect, it, vi } from 'vitest';
import { DYNAMICS_METRICS, ROLLING_WINDOWS, type RollingDynamicsResponse } from './features/dynamics/model/dynamics.models';
import { buildRollingAggregateRows, formatRollingValue, rollingDynamicsChartOptions, scoreContributionChartOptions } from './rolling-dynamics.view-model';

const response: RollingDynamicsResponse = {
  range: { from: '2026-01-30', to: '2026-01-31' }, metric: 'run', unit: 'metres', windows: [30, 365],
  points: [
    { date: '2026-01-30', dailyValue: 0, windows: { 30: { total: 42_195, calendarDayAverage: 1_406.5, activeDays: 28, recordedDays: 30, windowDays: 30, complete: true }, 365: { total: 100_000, calendarDayAverage: 273.9726, activeDays: 120, recordedDays: 30, windowDays: 365, complete: false } } },
    { date: '2026-01-31', dailyValue: null, windows: { 30: { total: 0, calendarDayAverage: 0, activeDays: 27, recordedDays: 29, windowDays: 30, complete: false }, 365: { total: 100_000, calendarDayAverage: 273.9726, activeDays: 119, recordedDays: 29, windowDays: 365, complete: false } } },
  ],
  scoreContributions: { 30: {
    windowDays: 30,
    categories: ['run', 'bonus'],
    points: [
      { date: '2026-01-30', contributions: { run: 10, bonus: 2 }, total: 12 },
      { date: '2026-01-31', contributions: { run: 8, bonus: 3 }, total: 11 },
    ],
  } },
};

describe('rolling dynamics view model', () => {
  it('renders one series per trailing window in display units', () => {
    const options = rollingDynamicsChartOptions(response, 'recordedDayAverage') as Record<string, any>;
    expect(options.yAxis.name).toBe('km');
    expect(options.series.map((series: any) => series.name)).toEqual(['30d avg/day', '365d avg/day']);
    expect(options.series[0].data).toEqual([1.4065, 0]);
    expect(options.tooltip.valueFormatter(10.296333333333333)).toBe('10.3 km');
  });

  it('keeps missing and recorded zero values distinct', () => {
    expect(formatRollingValue(null, 'metres')).toBe('—');
    expect(formatRollingValue(0, 'metres')).toBe('0 km');
  });

  it('renders active-day frequency as days rather than the metric unit', () => {
    const options = rollingDynamicsChartOptions(response, 'activeDays') as Record<string, any>;
    expect(options.yAxis.name).toBe('days');
    expect(options.series.map((series: any) => series.name)).toEqual(['30d active days', '365d active days']);
    expect(options.series[0].data).toEqual([28, 27]);
    expect(options.tooltip.valueFormatter(28)).toBe('28 days');
  });

  it('renders authoritative score contributions as smooth stacked areas', () => {
    const options = scoreContributionChartOptions(response) as Record<string, any>;
    expect(options.series.map((series: any) => series.name)).toEqual(['Run', 'Bonus']);
    expect(options.series.every((series: any) => series.stack === 'score-contribution' && series.areaStyle)).toBe(true);
    expect(options.series[0].data).toEqual([10, 8]);
    expect(options.tooltip.valueFormatter(10.25)).toBe('10 pts/day');
  });

  it('includes and labels today for every metric, measure, window and contribution series, excluding future days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 0, 15));
    try {
      const data = {
        ...response,
        windows: [...ROLLING_WINDOWS],
        points: [...response.points, { ...response.points[1]!, date: '2026-02-01' }],
        scoreContributions: Object.fromEntries(ROLLING_WINDOWS.map((window) => [window, {
          ...response.scoreContributions[30]!,
          windowDays: window,
          points: [...response.scoreContributions[30]!.points, {
            ...response.scoreContributions[30]!.points[1]!, date: '2026-02-01',
          }],
        }])),
      };
      for (const metric of DYNAMICS_METRICS) {
        for (const measure of ['total', 'recordedDayAverage', 'activeDays'] as const) {
          const options = rollingDynamicsChartOptions({ ...data, metric }, measure) as Record<string, any>;
          expect(options.xAxis.data).toEqual(['2026-01-30', '2026-01-31 (Incomplete)']);
          expect(options.xAxis.axisLabel).toMatchObject({ showMaxLabel: true, alignMaxLabel: 'right' });
          expect(options.xAxis.axisLabel.formatter(options.xAxis.data.at(-1))).toBe('2026-01-31\nIncomplete');
          expect(options.series).toHaveLength(ROLLING_WINDOWS.length);
          expect(options.series.every((series: any) => series.data.length === 2)).toBe(true);
        }
      }
      for (const window of ROLLING_WINDOWS) {
        const options = scoreContributionChartOptions(data, window) as Record<string, any>;
        expect(options.xAxis.data).toEqual(['2026-01-30', '2026-01-31 (Incomplete)']);
        expect(options.xAxis.axisLabel).toMatchObject({ showMaxLabel: true, alignMaxLabel: 'right' });
        expect(options.series.map((series: any) => series.data)).toEqual([[10, 8], [2, 3]]);
      }
      const totals = rollingDynamicsChartOptions(data, 'total') as Record<string, any>;
      expect(totals.series[data.windows.indexOf(30)].data).toEqual([42.195, 0]);
      expect(data.points).toHaveLength(3);
      expect(response.points).toHaveLength(2);
      const todayOnly = { ...data, points: data.points.slice(1, 2) };
      expect((rollingDynamicsChartOptions(todayOnly, 'total') as Record<string, any>).xAxis.data).toEqual(['2026-01-31 (Incomplete)']);
      const futureOnly = { ...data, points: data.points.slice(2) };
      expect((rollingDynamicsChartOptions(futureOnly, 'total') as Record<string, any>).xAxis.data).toEqual([]);
      const historicalOnly = { ...data, points: data.points.slice(0, 1) };
      expect((rollingDynamicsChartOptions(historicalOnly, 'total') as Record<string, any>).xAxis.data).toEqual(['2026-01-30']);

      vi.setSystemTime(new Date(2026, 1, 1, 0, 15));
      expect((rollingDynamicsChartOptions(todayOnly, 'total') as Record<string, any>).xAxis.data).toEqual(['2026-01-31']);
      expect((scoreContributionChartOptions(data) as Record<string, any>).xAxis.data).toEqual([
        '2026-01-30', '2026-01-31', '2026-02-01 (Incomplete)',
      ]);
    } finally { vi.useRealTimers(); }
  });

  it('builds the selected-cycle aggregate row across training metrics', () => {
    const responses = Object.fromEntries(['run', 'swim', 'bike', 'steps', 'score', 'bonus', 'workout'].map((metric) => [metric, {
      ...response,
      metric,
      points: response.points.map((point) => ({
        ...point,
        windows: { 30: { ...point.windows[30], calendarDayAverage: metric === 'run' ? 1.4065 : 2 } },
      })),
    }])) as any;

    expect(buildRollingAggregateRows(responses, 30)).toEqual([
      { date: '2026-01-30', values: { run: 1.4065, swim: 2, bike: 2, steps: 2, score: 2, bonus: 2, workout: 2 }, complete: true },
      { date: '2026-01-31', values: { run: 1.4065, swim: 2, bike: 2, steps: 2, score: 2, bonus: 2, workout: 2 }, complete: false },
    ]);
  });
});
