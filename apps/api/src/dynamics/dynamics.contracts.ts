import type { DynamicsDailyRow } from '@sportos/db';

export const DYNAMICS_METRICS = ['score', 'steps', 'run', 'bike', 'swim', 'workout', 'power'] as const;
export type DynamicsMetric = typeof DYNAMICS_METRICS[number];
export type DynamicsGranularity = 'daily' | 'weekly' | 'monthly';

export interface DynamicsQuery {
  from: string;
  to: string;
  granularity: DynamicsGranularity;
  metrics: DynamicsMetric[];
}

export interface DynamicsMetricAggregate {
  total: number | null;
  recordedDayAverage: number | null;
}

export interface DynamicsBucket {
  key: string;
  from: string;
  to: string;
  calendarDays: number;
  recordedDays: number;
  partial: boolean;
  values: Partial<Record<DynamicsMetric, DynamicsMetricAggregate>>;
}

export interface DynamicsResponse {
  range: { from: string; to: string };
  granularity: DynamicsGranularity;
  metrics: DynamicsMetric[];
  metricUnits: Record<DynamicsMetric, 'points' | 'steps' | 'metres'>;
  monthly: DynamicsBucket[];
  series: DynamicsBucket[];
}

export function buildDynamicsResponse(rows: DynamicsDailyRow[], query: DynamicsQuery): DynamicsResponse {
  return {
    range: { from: query.from, to: query.to },
    granularity: query.granularity,
    metrics: query.metrics,
    metricUnits: {
      score: 'points', steps: 'steps', run: 'metres', bike: 'metres', swim: 'metres', workout: 'points', power: 'points',
    },
    monthly: aggregate(rows, query.from, query.to, 'monthly', query.metrics),
    series: aggregate(rows, query.from, query.to, query.granularity, query.metrics),
  };
}

function aggregate(
  rows: DynamicsDailyRow[],
  from: string,
  to: string,
  granularity: DynamicsGranularity,
  metrics: DynamicsMetric[],
): DynamicsBucket[] {
  const rowsByDate = new Map(rows.map((row) => [row.metricDate, row]));
  const buckets = new Map<string, { from: string; to: string; dates: string[] }>();

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const key = bucketKey(date, granularity);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.to = date;
      bucket.dates.push(date);
    } else {
      buckets.set(key, { from: date, to: date, dates: [date] });
    }
  }

  return [...buckets].map(([key, bucket]) => {
    const recordedRows = bucket.dates.flatMap((date) => {
      const row = rowsByDate.get(date);
      return row ? [row] : [];
    });
    const values = Object.fromEntries(metrics.map((metric) => {
      if (recordedRows.length === 0) return [metric, { total: null, recordedDayAverage: null }];
      const total = recordedRows.reduce((sum, row) => sum + row[metric], 0);
      return [metric, { total, recordedDayAverage: total / recordedRows.length }];
    })) as Partial<Record<DynamicsMetric, DynamicsMetricAggregate>>;

    return {
      key,
      from: bucket.from,
      to: bucket.to,
      calendarDays: bucket.dates.length,
      recordedDays: recordedRows.length,
      partial: isPartialBucket(bucket.from, bucket.to, granularity),
      values,
    };
  });
}

function bucketKey(date: string, granularity: DynamicsGranularity): string {
  if (granularity === 'daily') return date;
  if (granularity === 'monthly') return date.slice(0, 7);
  const parsed = utcDate(date);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

function isPartialBucket(from: string, to: string, granularity: DynamicsGranularity): boolean {
  if (granularity === 'daily') return false;
  if (granularity === 'monthly') {
    return from !== `${from.slice(0, 7)}-01` || to !== monthEnd(to);
  }
  const start = utcDate(from);
  const end = utcDate(to);
  return (start.getUTCDay() || 7) !== 1 || (end.getUTCDay() || 7) !== 7;
}

function monthEnd(date: string): string {
  const parsed = utcDate(date);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

function addDays(date: string, count: number): string {
  const parsed = utcDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + count);
  return parsed.toISOString().slice(0, 10);
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
