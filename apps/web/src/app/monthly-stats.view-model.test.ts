import { describe, expect, it } from 'vitest';
import type { DynamicsResponse } from './api.service';
import { dynamicsChartOptions, formatDynamicsValue } from './monthly-stats.view-model';

const response: DynamicsResponse = {
  range: { from: '2026-01-01', to: '2026-02-28' },
  granularity: 'monthly',
  metrics: ['score', 'run'],
  metricUnits: { score: 'points', steps: 'steps', run: 'metres', bike: 'metres', swim: 'metres', workout: 'points', power: 'points' },
  monthly: [],
  series: [
    { key: '2026-01', from: '2026-01-01', to: '2026-01-31', calendarDays: 31, recordedDays: 2, partial: false, values: { score: { total: 200, recordedDayAverage: 100 }, run: { total: 10_000, recordedDayAverage: 5_000 } } },
    { key: '2026-02', from: '2026-02-01', to: '2026-02-28', calendarDays: 28, recordedDays: 0, partial: false, values: { score: { total: null, recordedDayAverage: null }, run: { total: null, recordedDayAverage: null } } },
  ],
};

describe('dynamics view model', () => {
  it('keeps unlike absolute metrics on separately labelled axes and converts metres to kilometres', () => {
    const options = dynamicsChartOptions(response, 'total', 'absolute') as Record<string, any>;
    expect(options.yAxis).toHaveLength(2);
    expect(options.yAxis.map((axis: any) => axis.name)).toEqual(['Official score (points)', 'Run (km)']);
    expect(options.series[1].data).toEqual([10, null]);
  });

  it('indexes each series independently from its first non-zero value', () => {
    const options = dynamicsChartOptions({ ...response, series: [...response.series, { ...response.series[0]!, key: '2026-03', values: { score: { total: 300, recordedDayAverage: 150 }, run: { total: 15_000, recordedDayAverage: 7_500 } } }] }, 'total', 'indexed') as Record<string, any>;
    expect(options.yAxis).toHaveLength(1);
    expect(options.series[0].data).toEqual([100, null, 150]);
    expect(options.series[1].data).toEqual([100, null, 150]);
  });

  it('formats recorded zero distinctly from a missing bucket', () => {
    const recordedZero = { ...response.series[0]!, values: { run: { total: 0, recordedDayAverage: 0 } } };
    expect(formatDynamicsValue(recordedZero, 'run', 'total', 'metres')).toBe('0 km');
    expect(formatDynamicsValue(response.series[1]!, 'run', 'total', 'metres')).toBe('—');
  });
});
