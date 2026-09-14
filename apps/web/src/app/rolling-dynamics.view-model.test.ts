import { describe, expect, it } from 'vitest';
import type { RollingDynamicsResponse } from './api.service';
import { formatRollingValue, rollingDynamicsChartOptions } from './rolling-dynamics.view-model';

const response: RollingDynamicsResponse = {
  range: { from: '2026-01-30', to: '2026-01-31' }, metric: 'run', unit: 'metres', windows: [30, 365],
  points: [
    { date: '2026-01-30', dailyValue: 0, windows: { 30: { total: 42_195, calendarDayAverage: 1_406.5, recordedDays: 30, windowDays: 30, complete: true }, 365: { total: 100_000, calendarDayAverage: 273.9726, recordedDays: 30, windowDays: 365, complete: false } } },
    { date: '2026-01-31', dailyValue: null, windows: { 30: { total: 0, calendarDayAverage: 0, recordedDays: 29, windowDays: 30, complete: false }, 365: { total: 100_000, calendarDayAverage: 273.9726, recordedDays: 29, windowDays: 365, complete: false } } },
  ],
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
});
