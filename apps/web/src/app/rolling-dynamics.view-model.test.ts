import { describe, expect, it } from 'vitest';
import type { RollingDynamicsResponse } from './features/dynamics/model/dynamics.models';
import { formatRollingValue, rollingDynamicsChartOptions, scoreContributionChartOptions } from './rolling-dynamics.view-model';

const response: RollingDynamicsResponse = {
  range: { from: '2026-01-30', to: '2026-01-31' }, metric: 'run', unit: 'metres', windows: [30, 365],
  points: [
    { date: '2026-01-30', dailyValue: 0, windows: { 30: { total: 42_195, calendarDayAverage: 1_406.5, activeDays: 28, recordedDays: 30, windowDays: 30, complete: true }, 365: { total: 100_000, calendarDayAverage: 273.9726, activeDays: 120, recordedDays: 30, windowDays: 365, complete: false } } },
    { date: '2026-01-31', dailyValue: null, windows: { 30: { total: 0, calendarDayAverage: 0, activeDays: 27, recordedDays: 29, windowDays: 30, complete: false }, 365: { total: 100_000, calendarDayAverage: 273.9726, activeDays: 119, recordedDays: 29, windowDays: 365, complete: false } } },
  ],
  scoreContributions: {
    windowDays: 30,
    categories: ['run', 'bonus'],
    points: [
      { date: '2026-01-30', contributions: { run: 10, bonus: 2 }, total: 12 },
      { date: '2026-01-31', contributions: { run: 8, bonus: 3 }, total: 11 },
    ],
  },
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
});
