import type { DynamicsDailyRow, ScoreContributionRow } from '@sportos/db';

export const DYNAMICS_METRICS = ['score', 'steps', 'run', 'bike', 'swim', 'workout', 'bonus'] as const;
export type DynamicsMetric = typeof DYNAMICS_METRICS[number];
export type DynamicsGranularity = 'daily' | 'weekly' | 'monthly';
export const ROLLING_WINDOWS = [7, 20, 30, 60, 365] as const;
export type RollingWindow = typeof ROLLING_WINDOWS[number];
export const SCORE_CONTRIBUTION_CATEGORIES = ['steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'bonus'] as const;
export type ScoreContributionCategory = typeof SCORE_CONTRIBUTION_CATEGORIES[number];

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
  scoreContributions?: Partial<Record<ScoreContributionCategory, number>>;
}

export interface DynamicsResponse {
  range: { from: string; to: string };
  granularity: DynamicsGranularity;
  metrics: DynamicsMetric[];
  metricUnits: Record<DynamicsMetric, 'points' | 'steps' | 'metres'>;
  monthly: DynamicsBucket[];
  series: DynamicsBucket[];
}

export interface RollingDynamicsQuery {
  from: string;
  to: string;
  metric: DynamicsMetric;
  windows: RollingWindow[];
}

export interface RollingMetricValue {
  total: number | null;
  calendarDayAverage: number | null;
  activeDays: number | null;
  recordedDays: number;
  windowDays: number;
  complete: boolean;
}

export interface RollingDynamicsPoint {
  date: string;
  dailyValue: number | null;
  windows: Partial<Record<RollingWindow, RollingMetricValue>>;
}

export interface RollingDynamicsResponse {
  range: { from: string; to: string };
  metric: DynamicsMetric;
  unit: 'points' | 'steps' | 'metres';
  windows: RollingWindow[];
  points: RollingDynamicsPoint[];
  scoreContributions: Partial<Record<RollingWindow, {
    windowDays: RollingWindow;
    categories: ScoreContributionCategory[];
    points: ScoreContributionPoint[];
  }>>;
}

export interface ScoreContributionPoint {
  date: string;
  contributions: Partial<Record<ScoreContributionCategory, number>>;
  total: number;
}

export function buildDynamicsResponse(
  rows: DynamicsDailyRow[],
  query: DynamicsQuery,
  contributionRows: ScoreContributionRow[] = [],
): DynamicsResponse {
  const monthlyMetrics: DynamicsMetric[] = query.metrics.includes('score') ? query.metrics : [...query.metrics, 'score'];
  const monthly = aggregate(rows, query.from, query.to, 'monthly', monthlyMetrics).map((bucket) => ({
    ...bucket,
    scoreContributions: aggregateScoreContributions(contributionRows, bucket),
  }));

  return {
    range: { from: query.from, to: query.to },
    granularity: query.granularity,
    metrics: query.metrics,
    metricUnits: {
      score: 'points', steps: 'steps', run: 'metres', bike: 'metres', swim: 'metres', workout: 'points', bonus: 'points',
    },
    monthly,
    series: aggregate(rows, query.from, query.to, query.granularity, query.metrics),
  };
}

export function buildRollingDynamicsResponse(
  rows: DynamicsDailyRow[],
  query: RollingDynamicsQuery,
  contributionRows: ScoreContributionRow[] = [],
): RollingDynamicsResponse {
  const rowsByDate = new Map(rows.map((row) => [row.metricDate, row]));
  const points: RollingDynamicsPoint[] = [];

  for (let date = query.from; date <= query.to; date = addDays(date, 1)) {
    const dailyRow = rowsByDate.get(date);
    const windows = Object.fromEntries(query.windows.map((windowDays) => {
      let total = 0;
      let recordedDays = 0;
      let activeDays = 0;
      const windowFrom = addDays(date, -(windowDays - 1));
      for (let candidate = windowFrom; candidate <= date; candidate = addDays(candidate, 1)) {
        const row = rowsByDate.get(candidate);
        if (!row) continue;
        total += row[query.metric];
        recordedDays += 1;
        if (row[query.metric] > 0) activeDays += 1;
      }
      return [windowDays, {
        total: recordedDays ? total : null,
        calendarDayAverage: recordedDays ? total / windowDays : null,
        activeDays: recordedDays ? activeDays : null,
        recordedDays,
        windowDays,
        complete: recordedDays === windowDays,
      }];
    })) as Partial<Record<RollingWindow, RollingMetricValue>>;
    points.push({ date, dailyValue: dailyRow?.[query.metric] ?? null, windows });
  }

  return {
    range: { from: query.from, to: query.to },
    metric: query.metric,
    unit: metricUnit(query.metric),
    windows: query.windows,
    points,
    scoreContributions: Object.fromEntries(query.windows.map((window) => [window, buildScoreContributions(contributionRows, query.from, query.to, window)])),
  };
}

function buildScoreContributions(
  rows: ScoreContributionRow[],
  from: string,
  to: string,
  windowDays: RollingWindow,
): NonNullable<RollingDynamicsResponse['scoreContributions'][RollingWindow]> {
  const normalizedRows = rows.map((row) => ({
    ...row,
    category: row.activityType as ScoreContributionCategory,
  }));
  const categories = SCORE_CONTRIBUTION_CATEGORIES.filter((category) =>
    normalizedRows.some((row) => row.category === category && row.points !== 0));
  const valuesByDate = new Map<string, Partial<Record<ScoreContributionCategory, number>>>();
  for (const row of normalizedRows) {
    const values = valuesByDate.get(row.metricDate) ?? {};
    values[row.category] = (values[row.category] ?? 0) + row.points;
    valuesByDate.set(row.metricDate, values);
  }

  const points: ScoreContributionPoint[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const totals: Partial<Record<ScoreContributionCategory, number>> = {};
    for (let candidate = addDays(date, -(windowDays - 1)); candidate <= date; candidate = addDays(candidate, 1)) {
      const daily = valuesByDate.get(candidate);
      if (!daily) continue;
      for (const category of categories) totals[category] = (totals[category] ?? 0) + (daily[category] ?? 0);
    }
    const contributions = Object.fromEntries(categories.map((category) => [category, (totals[category] ?? 0) / windowDays])) as Partial<Record<ScoreContributionCategory, number>>;
    points.push({ date, contributions, total: Object.values(contributions).reduce((sum, value) => sum + value, 0) });
  }
  return { windowDays, categories, points };
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

function aggregateScoreContributions(
  rows: ScoreContributionRow[],
  bucket: DynamicsBucket,
): Partial<Record<ScoreContributionCategory, number>> {
  const totals: Partial<Record<ScoreContributionCategory, number>> = {};
  for (const row of rows) {
    if (row.metricDate < bucket.from || row.metricDate > bucket.to) continue;
    const category = row.activityType as ScoreContributionCategory;
    if (!SCORE_CONTRIBUTION_CATEGORIES.includes(category)) continue;
    totals[category] = (totals[category] ?? 0) + row.points;
  }
  return totals;
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

export function rollingLookbackFrom(from: string, windows: RollingWindow[]): string {
  return addDays(from, -(Math.max(...windows) - 1));
}

function metricUnit(metric: DynamicsMetric): RollingDynamicsResponse['unit'] {
  if (metric === 'steps') return 'steps';
  if (metric === 'run' || metric === 'bike' || metric === 'swim') return 'metres';
  return 'points';
}
