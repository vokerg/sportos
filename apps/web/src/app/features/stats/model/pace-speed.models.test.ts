import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS, bucketDateRange, fillTrendBuckets, formatPace,
  formatTrendValue, thresholdOptions, trendChartOptions, type PaceSpeedResponse,
} from './pace-speed.models';

const response: PaceSpeedResponse = {
  source: 'strava', range: { from: '2026-01-07', to: '2026-01-27' },
  sport: 'run',
  granularity: 'weekly',
  threshold: 360,
  buckets: [
    { key: '2026-01-05', totalDistanceM: 15000, includedDistanceM: 12000,
      includedTimeS: 3600, missingTimeDistanceM: 1000, activities: 3, includedActivities: 2, value: 300 },
    { key: '2026-01-19', totalDistanceM: 3000, includedDistanceM: 0,
      includedTimeS: 0, missingTimeDistanceM: 3000, activities: 1, includedActivities: 0, value: null },
  ],
};

describe('pace speed trend view model', () => {
  it('fills missing calendar weeks with null averages and preserved included/excluded volume', () => {
    const buckets = fillTrendBuckets(response);
    expect(buckets.map(b => b.key)).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
    expect(buckets[0]).toMatchObject({ totalDistanceM: 15000, includedDistanceM: 12000, value: 300 });
    expect(buckets[1]).toMatchObject({ totalDistanceM: 0, activities: 0, value: null });
    expect(buckets[2]).toMatchObject({ totalDistanceM: 3000, includedDistanceM: 0, value: null });
  });

  it('supports month and day buckets, including leap days and clipped activity links', () => {
    expect(fillTrendBuckets({ ...response, granularity: 'monthly' }).map(b => b.key)).toEqual(['2026-01-01']);
    expect(fillTrendBuckets({ ...response, source: 'strava', range: { from: '2024-02-28', to: '2024-03-01' }, buckets: [], granularity: 'daily' }).map(b => b.key))
      .toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(bucketDateRange('2026-01-05', 'weekly', '2026-01-07', '2026-01-27')).toEqual({ from: '2026-01-07', to: '2026-01-11' });
    expect(bucketDateRange('2026-01-26', 'weekly', '2026-01-07', '2026-01-27')).toEqual({ from: '2026-01-26', to: '2026-01-27' });
  });

  it('uses sport-specific units and configurable running defaults', () => {
    expect(DEFAULT_THRESHOLDS.run).toBe(360);
    expect(thresholdOptions('run')).toContainEqual({ value: 360, label: '6:00 /km' });
    expect(formatPace(309.6)).toBe('5:10');
    expect(formatTrendValue(325, 'run')).toBe('5:25 /km');
    expect(formatTrendValue(110, 'swim')).toBe('1:50 /100m');
    expect(formatTrendValue(29.63, 'bike')).toBe('29.6 km/h');
    expect(formatTrendValue(null, 'bike')).toBe('—');
  });

  it('provides separate pace/speed and stacked volume series with gaps', () => {
    const rows = fillTrendBuckets(response);
    const chart = trendChartOptions(rows, 'run');
    const series = chart.series as Array<{ data: unknown[] }>;
    expect(series).toHaveLength(4);
    expect(series[0]?.data).toEqual([300, null, null, null]);
    expect(series[1]?.data).toEqual([12, 0, 0, 0]);
    expect(series[2]?.data).toEqual([2, 0, 0, 0]);
    expect(series[3]?.data).toEqual([1, 0, 3, 0]);
    const bike = trendChartOptions(rows, 'bike');
    expect(bike.yAxis).toEqual(expect.arrayContaining([expect.objectContaining({ inverse: false })]));
  });
});
