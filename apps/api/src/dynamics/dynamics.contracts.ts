import type { DynamicsDailyRow, ScoreContributionRow } from '@sportos/db';

export const DYNAMICS_METRICS = ['score', 'steps', 'run', 'bike', 'swim', 'workout', 'bonus'] as const;
export type DynamicsMetric = typeof DYNAMICS_METRICS[number];
export type DynamicsGranularity = 'daily' | 'weekly' | 'monthly';
export type DistanceMetric = 'run' | 'bike' | 'swim';
export const ROLLING_WINDOWS = [7, 20, 30, 60, 365] as const;
export type RollingWindow = typeof ROLLING_WINDOWS[number];
export const SCORE_CONTRIBUTION_CATEGORIES = ['steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'bonus', 'unattributed'] as const;
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
  distanceTotals?: Partial<Record<DistanceMetric, number>>;
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
    distanceTotals: aggregateDistanceTotals(rows, bucket),
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
  const columns = rollingColumns(rows, query.from, query.to, [query.metric], query.windows);
  const points: RollingDynamicsPoint[] = columns.dates.map((date, i) => ({
    date,
    dailyValue: columns.daily[query.metric][i]!,
    windows: Object.fromEntries(query.windows.map((window) => {
      const values = columns.windows[window]!;
      const total = values.totals[query.metric][i]!;
      const recordedDays = values.recordedDays[i]!;
      return [window, { total, calendarDayAverage: total === null ? null : total / window,
        activeDays: values.activeDays[query.metric][i]!, recordedDays, windowDays: window, complete: recordedDays === window }];
    })),
  }));

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
  const totals: Partial<Record<ScoreContributionCategory, number>> = {};
  const start = addDays(from, -(windowDays - 1));
  for (let date = start; date <= to; date = addDays(date, 1)) {
    const daily = valuesByDate.get(date);
    const expiredDate = addDays(date, -windowDays);
    const expired = expiredDate >= start ? valuesByDate.get(expiredDate) : undefined;
    for (const category of categories) totals[category] = (totals[category] ?? 0) + (daily?.[category] ?? 0) - (expired?.[category] ?? 0);
    if (date < from) continue;
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

function aggregateDistanceTotals(
  rows: DynamicsDailyRow[],
  bucket: DynamicsBucket,
): Partial<Record<DistanceMetric, number>> {
  const totals: Partial<Record<DistanceMetric, number>> = {};
  for (const row of rows) {
    if (row.metricDate < bucket.from || row.metricDate > bucket.to) continue;
    for (const metric of ['run', 'bike', 'swim'] as const) {
      totals[metric] = (totals[metric] ?? 0) + row[metric];
    }
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


/** Columnar transport avoids repeating metric/window/date labels for every value. */
export interface DynamicsHistoryResponse {
  version: 1;
  range: { from: string; to: string };
  dates: string[];
  daily: Record<DynamicsMetric, Array<number | null>>;
  windows: Partial<Record<RollingWindow, {
    recordedDays: number[];
    totals: Record<DynamicsMetric, Array<number | null>>;
    activeDays: Record<DynamicsMetric, Array<number | null>>;
  }>>;
  scoreContributions: RollingDynamicsResponse['scoreContributions'];
  records: DynamicsRecord[];
}

export interface DynamicsRecord {
  metric: DynamicsMetric;
  windowDays: 1 | RollingWindow;
  /** Calendar year of the window end date, or all time. */
  period: string;
  date: string;
  value: number;
  recordedDays: number;
}

function metricColumns(): Record<DynamicsMetric, Array<number | null>> {
  return Object.fromEntries(DYNAMICS_METRICS.map((metric) => [metric, [] as Array<number | null>])) as Record<DynamicsMetric, Array<number | null>>;
}

function rollingColumns(rows: DynamicsDailyRow[], from: string, to: string, metrics: readonly DynamicsMetric[], windows: readonly RollingWindow[]) {
  const daily = metricColumns();
  const dates: string[] = [];
  const output: DynamicsHistoryResponse['windows'] = {};
  const byDate = new Map(rows.map((row) => [row.metricDate, row]));
  for (const window of windows) output[window] = { recordedDays: [], totals: metricColumns(), activeDays: metricColumns() };
  const states = windows.map((window) => ({ window, recorded: 0,
    totals: Object.fromEntries(metrics.map((metric) => [metric, 0])) as Record<DynamicsMetric, number>,
    active: Object.fromEntries(metrics.map((metric) => [metric, 0])) as Record<DynamicsMetric, number> }));
  const start = addDays(from, -(Math.max(...windows) - 1));
  for (let date = start; date <= to; date = addDays(date, 1)) {
    const row = byDate.get(date);
    for (const state of states) {
      const expiredDate = addDays(date, -state.window);
      const expired = expiredDate >= start ? byDate.get(expiredDate) : undefined;
      state.recorded += Number(Boolean(row)) - Number(Boolean(expired));
      for (const metric of metrics) {
        // daily_metrics distances are numeric(12,2); sum hundredths to keep
        // equal windows tied instead of accumulating floating-point drift.
        state.totals[metric] += Math.round((row?.[metric] ?? 0) * 100) - Math.round((expired?.[metric] ?? 0) * 100);
        state.active[metric] += Number((row?.[metric] ?? 0) > 0) - Number((expired?.[metric] ?? 0) > 0);
      }
      if (date < from) continue;
      const values = output[state.window]!;
      values.recordedDays.push(state.recorded);
      for (const metric of metrics) {
        values.totals[metric].push(state.recorded ? state.totals[metric] / 100 : null);
        values.activeDays[metric].push(state.recorded ? state.active[metric] : null);
      }
    }
    if (date < from) continue;
    dates.push(date);
    for (const metric of metrics) daily[metric].push(row?.[metric] ?? null);
  }
  return { dates, daily, windows: output };
}

function historyColumns(rows: DynamicsDailyRow[], to: string) {
  // Repository rows are ordered, but pure callers need not be.
  const from = rows.reduce((earliest, row) => row.metricDate < earliest ? row.metricDate : earliest, to);
  const columns = rows.length ? rollingColumns(rows, from, to, DYNAMICS_METRICS, ROLLING_WINDOWS)
    : { dates: [], daily: metricColumns(), windows: {} };
  return { range: { from, to }, ...columns };
}

function recordsFromHistory(columns: Pick<DynamicsHistoryResponse, 'dates' | 'daily' | 'windows'>): DynamicsRecord[] {
  const records = new Map<string, DynamicsRecord>();
  const consider = (metric: DynamicsMetric, windowDays: 1 | RollingWindow, date: string, value: number | null, recordedDays: number) => {
    if (value === null) return;
    for (const period of ['all', date.slice(0, 4)]) {
      const key = `${metric}:${windowDays}:${period}`;
      // First date wins ties; recomputing from canonical rows handles decreases/removals.
      if (!records.has(key) || value > records.get(key)!.value) records.set(key, { metric, windowDays, period, date, value, recordedDays });
    }
  };
  columns.dates.forEach((date, i) => {
    for (const metric of DYNAMICS_METRICS) {
      consider(metric, 1, date, columns.daily[metric][i]!, columns.daily[metric][i] === null ? 0 : 1);
      for (const window of ROLLING_WINDOWS) {
        // Do not rank startup windows before a full calendar span exists.
        if (i < window - 1) continue;
        const values = columns.windows[window]!;
        const total = values.totals[metric][i]!;
        consider(metric, window, date, total === null ? null : total / window, values.recordedDays[i]!);
      }
    }
  });
  return [...records.values()];
}

export function buildDynamicsRecords(rows: DynamicsDailyRow[], to: string): DynamicsRecord[] {
  return recordsFromHistory(historyColumns(rows, to));
}

export function buildDynamicsHistory(rows: DynamicsDailyRow[], to: string, contributions: ScoreContributionRow[] = []): DynamicsHistoryResponse {
  const columns = historyColumns(rows, to);
  const { from } = columns.range;
  return { version: 1, ...columns, records: recordsFromHistory(columns),
    scoreContributions: rows.length ? Object.fromEntries(ROLLING_WINDOWS.map((window) => [window, buildScoreContributions(contributions, from, to, window)])) : {} };
}
