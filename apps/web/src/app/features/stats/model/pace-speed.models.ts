import type { EChartsOption } from 'echarts';

export type PaceSpeedSport = 'run' | 'bike' | 'swim';
export type PaceSpeedGranularity = 'daily' | 'weekly' | 'monthly';

export interface PaceSpeedBucket {
  key: string;
  totalDistanceM: number;
  includedDistanceM: number;
  includedTimeS: number;
  activities: number;
  includedActivities: number;
  value: number | null;
}

export interface PaceSpeedResponse {
  range: { from: string; to: string };
  sport: PaceSpeedSport;
  granularity: PaceSpeedGranularity;
  threshold: number | null;
  buckets: PaceSpeedBucket[];
}

export const DEFAULT_THRESHOLDS: Record<PaceSpeedSport, number> = { run: 360, bike: 15, swim: 180 };

export function thresholdOptions(sport: PaceSpeedSport): Array<{ value: number; label: string }> {
  const start = sport === 'run' ? 180 : sport === 'swim' ? 60 : 5;
  const end = sport === 'run' ? 600 : sport === 'swim' ? 300 : 50;
  const step = sport === 'run' ? 15 : sport === 'swim' ? 5 : 1;
  const options = [];
  for (let value = start; value <= end; value += step) {
    options.push({ value, label: sport === 'bike' ? String(value) + ' km/h' : formatPace(value) + (sport === 'swim' ? ' /100m' : ' /km') });
  }
  return options;
}

export function formatPace(seconds: number): string {
  const rounded = Math.round(seconds);
  return String(Math.floor(rounded / 60)) + ':' + String(rounded % 60).padStart(2, '0');
}

export function formatTrendValue(value: number | null, sport: PaceSpeedSport): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return sport === 'bike' ? value.toFixed(1) + ' km/h' : formatPace(value) + (sport === 'swim' ? ' /100m' : ' /km');
}

export function formatKm(metres: number): string {
  return (metres / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** Keep empty periods explicit; never connect a trend line across missing training. */
export function fillTrendBuckets(response: PaceSpeedResponse): PaceSpeedBucket[] {
  const byKey = new Map(response.buckets.map(bucket => [bucket.key, bucket]));
  const rows: PaceSpeedBucket[] = [];
  const first = new Date(response.range.from + 'T00:00:00Z');
  const last = response.range.to;
  if (!Number.isFinite(first.getTime())) return [];
  if (response.granularity === 'monthly') first.setUTCDate(1);
  if (response.granularity === 'weekly') first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  for (let date = first; date.toISOString().slice(0, 10) <= last && rows.length < 3700;) {
    const key = date.toISOString().slice(0, 10);
    rows.push(byKey.get(key) ?? { key, totalDistanceM: 0, includedDistanceM: 0, includedTimeS: 0, activities: 0, includedActivities: 0, value: null });
    const next = new Date(date.getTime());
    if (response.granularity === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + (response.granularity === 'weekly' ? 7 : 1));
    date = next;
  }
  return rows;
}

export function bucketDateRange(key: string, granularity: PaceSpeedGranularity, from: string, to: string): { from: string; to: string } {
  const date = new Date(key + 'T00:00:00Z');
  if (granularity === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + (granularity === 'weekly' ? 7 : 1));
  date.setUTCDate(date.getUTCDate() - 1);
  const end = date.toISOString().slice(0, 10);
  return { from: key < from ? from : key, to: end > to ? to : end };
}

export function trendChartOptions(buckets: PaceSpeedBucket[], sport: PaceSpeedSport): EChartsOption {
  const labels = buckets.map(bucket => bucket.key);
  const pace = sport !== 'bike';
  return {
    animation: false,
    grid: [{ left: 62, right: 22, top: 40, height: '43%' }, { left: 62, right: 22, top: '69%', height: '20%' }],
    legend: { top: 0, data: [pace ? 'Weighted pace' : 'Weighted speed', 'Included km', 'Not used km'] },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const index = (Array.isArray(params) ? (params as Array<{ dataIndex?: number }>)[0]?.dataIndex : undefined) ?? 0;
        const bucket = buckets[index];
        if (!bucket) return '';
        return bucket.key + '<br/>' +
          (pace ? 'Pace: ' : 'Speed: ') + formatTrendValue(bucket.value, sport) + '<br/>' +
          'Included: ' + formatKm(bucket.includedDistanceM) + ' km<br/>' +
          'Not used: ' + formatKm(Math.max(0, bucket.totalDistanceM - bucket.includedDistanceM)) + ' km';
      },
    },
    xAxis: [
      { type: 'category', data: labels, boundaryGap: true, gridIndex: 0, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', data: labels, gridIndex: 1, axisLabel: { hideOverlap: true } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, scale: true, inverse: pace, name: pace ? (sport === 'run' ? 'min/km' : 'min/100m') : 'km/h',
        axisLabel: { formatter: (value: number) => pace ? formatPace(value) : value.toFixed(1) } },
      { type: 'value', gridIndex: 1, name: 'km', axisLabel: { formatter: '{value}' } },
    ],
    series: [
      { name: pace ? 'Weighted pace' : 'Weighted speed', type: 'line', xAxisIndex: 0, yAxisIndex: 0,
        data: buckets.map(bucket => bucket.value), connectNulls: false, symbolSize: 6,
        lineStyle: { width: 3, color: '#10a58c' }, itemStyle: { color: '#10a58c' } },
      { name: 'Included km', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, stack: 'volume',
        data: buckets.map(bucket => bucket.includedDistanceM / 1000), itemStyle: { color: '#4d81c8' } },
      { name: 'Not used km', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, stack: 'volume',
        data: buckets.map(bucket => Math.max(0, bucket.totalDistanceM - bucket.includedDistanceM) / 1000),
        itemStyle: { color: '#b4bfce' } },
    ],
  };
}
