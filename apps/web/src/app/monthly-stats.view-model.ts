import type { EChartsCoreOption } from 'echarts/core';
import type {
  DynamicsBucket,
  DynamicsMeasure,
  DynamicsMetric,
  DynamicsResponse,
  ScoreContributionCategory,
} from './api.service';

export type DynamicsMode = 'absolute' | 'indexed';

export const DYNAMICS_LABELS: Record<DynamicsMetric, string> = {
  score: 'Official score',
  steps: 'Steps',
  run: 'Run',
  bike: 'Bike',
  swim: 'Swim',
  workout: 'Workout points',
  bonus: 'Bonus points',
};

export const MONTHLY_LEDGER_COLUMNS = [
  { key: 'bike', label: 'Bike' },
  { key: 'run', label: 'Run' },
  { key: 'swim', label: 'SwimT' },
  { key: 'workout', label: 'Woth' },
  { key: 'steps', label: 'stepsT' },
  { key: 'bonus', label: 'Power' },
  { key: 'score', label: 'Sum' },
] as const satisfies ReadonlyArray<{ key: ScoreContributionCategory | 'score'; label: string }>;

export type MonthlyLedgerColumn = typeof MONTHLY_LEDGER_COLUMNS[number]['key'];

export interface MonthlyLedgerYear {
  year: string;
  months: DynamicsBucket[];
  totals: Partial<Record<MonthlyLedgerColumn, number>>;
  recordedDays: number;
  calendarDays: number;
}

export function buildMonthlyLedger(buckets: DynamicsBucket[]): MonthlyLedgerYear[] {
  const byYear = new Map<string, DynamicsBucket[]>();
  for (const bucket of buckets) {
    const year = bucket.key.slice(0, 4);
    const months = byYear.get(year) ?? [];
    months.push(bucket);
    byYear.set(year, months);
  }

  return [...byYear].map(([year, months]) => ({
    year,
    months,
    totals: Object.fromEntries(MONTHLY_LEDGER_COLUMNS.flatMap(({ key }) => {
      const values = months.map((bucket) => monthlyLedgerValue(bucket, key));
      const recorded = values.filter((value): value is number => value !== null);
      return recorded.length ? [[key, recorded.reduce((sum, value) => sum + value, 0)]] : [];
    })) as Partial<Record<MonthlyLedgerColumn, number>>,
    recordedDays: months.reduce((sum, bucket) => sum + bucket.recordedDays, 0),
    calendarDays: months.reduce((sum, bucket) => sum + bucket.calendarDays, 0),
  }));
}

export function monthlyLedgerValue(bucket: DynamicsBucket, key: MonthlyLedgerColumn): number | null {
  if (bucket.recordedDays === 0) return null;
  if (key === 'score') return bucket.values.score?.total ?? null;
  return bucket.scoreContributions?.[key] ?? 0;
}

const COLORS: Record<DynamicsMetric, string> = {
  score: '#2854d9', steps: '#d97706', run: '#059669', bike: '#7c3aed', swim: '#0284c7', workout: '#db2777', bonus: '#dc2626',
};

export function dynamicsChartOptions(
  response: DynamicsResponse | null,
  measure: DynamicsMeasure,
  mode: DynamicsMode,
  selectedMetrics: DynamicsMetric[] = response?.metrics ?? [],
): EChartsCoreOption {
  if (!response) return {};
  const metrics = selectedMetrics.filter((metric) => response.metrics.includes(metric));
  const units = metrics.map((metric) => displayUnit(response.metricUnits[metric]));
  const indexed = mode === 'indexed';
  const axes = indexed ? [{ type: 'value', name: 'Index (first non-zero = 100)' }] : metrics.map((metric, index) => ({
    type: 'value',
    name: units[index],
    position: index % 2 === 0 ? 'left' : 'right',
    offset: Math.floor(index / 2) * 56,
    axisLine: { show: true, lineStyle: { color: COLORS[metric] } },
    axisLabel: { color: COLORS[metric] },
    nameTextStyle: { color: COLORS[metric], fontWeight: 650 },
  }));
  const leftAxes = indexed ? 1 : Math.ceil(metrics.length / 2);
  const rightAxes = indexed ? 0 : Math.floor(metrics.length / 2);

  return {
    color: metrics.map((metric) => COLORS[metric]),
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 48 + ((leftAxes - 1) * 56), right: 24 + (rightAxes * 56), top: 54, bottom: 56, containLabel: true },
    xAxis: { type: 'category', data: response.series.map((bucket) => bucket.key), axisLabel: { hideOverlap: true } },
    yAxis: axes,
    series: metrics.map((metric, index) => {
      const absolute = response.series.map((bucket) => displayValue(bucket, metric, measure, response.metricUnits[metric]));
      return {
        name: `${DYNAMICS_LABELS[metric]} · ${measure === 'total' ? 'total' : 'recorded-day avg'}${indexed ? '' : ` (${units[index]})`}`,
        type: 'line',
        smooth: false,
        connectNulls: false,
        showSymbol: response.series.length <= 60,
        yAxisIndex: indexed ? 0 : index,
        data: indexed ? indexedValues(absolute) : absolute,
        tooltip: {
          valueFormatter: (value: unknown) => formatChartValue(value, indexed ? 'index' : response.metricUnits[metric]),
        },
      };
    }),
  };
}

function formatChartValue(value: unknown, unit: DynamicsResponse['metricUnits'][DynamicsMetric] | 'index'): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '—';
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: unit === 'metres' ? 2 : 1 }).format(numericValue);
  return unit === 'metres' ? `${formatted} km` : formatted;
}

export function formatDynamicsValue(
  bucket: DynamicsBucket,
  metric: DynamicsMetric,
  measure: DynamicsMeasure,
  unit: DynamicsResponse['metricUnits'][DynamicsMetric],
): string {
  const value = displayValue(bucket, metric, measure, unit);
  if (value === null) return '—';
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: unit === 'metres' ? 2 : 1 }).format(value);
  return unit === 'metres' ? `${formatted} km` : formatted;
}

function displayValue(
  bucket: DynamicsBucket,
  metric: DynamicsMetric,
  measure: DynamicsMeasure,
  unit: DynamicsResponse['metricUnits'][DynamicsMetric],
): number | null {
  const value = bucket.values[metric]?.[measure] ?? null;
  return value === null ? null : unit === 'metres' ? value / 1_000 : value;
}

function indexedValues(values: Array<number | null>): Array<number | null> {
  const base = values.find((value) => value !== null && value !== 0);
  if (base === undefined || base === null) return values.map(() => null);
  return values.map((value) => value === null ? null : (value / base) * 100);
}

function displayUnit(unit: DynamicsResponse['metricUnits'][DynamicsMetric]): string {
  return unit === 'metres' ? 'km' : unit;
}
