import type { EChartsCoreOption } from 'echarts/core';
import type { DailyScoreContributionCategory, DailySummaryRow } from './features/daily/model/daily.models';
import { formatDate } from './date-time';
import { boundedAllTimeRange, localCalendarDate, QUICK_RANGE_VALUES, quickRangeDates, type QuickRange } from './shared/util/analytics-query-state';

export { boundedAllTimeRange, QUICK_RANGE_VALUES, quickRangeDates };
export type { QuickRange };

export type DailyLogSummaryState = 'loading' | 'loaded' | 'empty' | 'error';

export const DEFAULT_QUICK_RANGE: Exclude<QuickRange, 'custom'> = '3m';
export const DAILY_LOG_PAGE_SIZES = [100, 200, 365] as const;

export interface DailyMetricRange {
  min: number;
  max: number;
}

export function positiveMetricRange(values: readonly unknown[]): DailyMetricRange | null {
  const positiveValues = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!positiveValues.length) return null;
  return { min: Math.min(...positiveValues), max: Math.max(...positiveValues) };
}

export function relativePastelBackground(
  value: unknown,
  range: DailyMetricRange | null,
  rgb: string,
): string | undefined {
  const numericValue = Number(value);
  if (!range || !Number.isFinite(numericValue) || numericValue <= 0) return undefined;

  const position = range.max === range.min
    ? 0.5
    : Math.max(0, Math.min(1, (numericValue - range.min) / (range.max - range.min)));
  const alpha = 0.1 + (position * 0.16);
  return `rgba(${rgb}, ${alpha.toFixed(2)})`;
}

export function dailyLogChartOptions(rows: readonly DailySummaryRow[]): EChartsCoreOption {
  const chronological = completedChartRows(rows).reverse();
  const compositions = chronological.map(dailyScoreComposition);
  const visibleComponents = DAILY_SCORE_COMPONENTS.filter((component) =>
    compositions.some((composition) => composition[component.key] !== 0),
  );
  const hasNegativeContribution = compositions.some((composition) =>
    DAILY_SCORE_COMPONENTS.some((component) => composition[component.key] < 0),
  );
  return {
    animation: false,
    color: [...visibleComponents.map((component) => component.color), '#84cc16'],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: unknown) => {
        const points = Number(value);
        return Number.isFinite(points) ? `${points.toLocaleString(undefined, { maximumFractionDigits: 1 })} pts` : '—';
      },
    },
    legend: { type: 'scroll', bottom: 0 },
    grid: { left: 66, right: 24, top: 38, bottom: 72, containLabel: true },
    xAxis: {
      type: 'category',
      data: chronological.map((row) => formatDate(row.metric_date)),
      axisLabel: { hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      name: 'Points',
      min: hasNegativeContribution ? undefined : 0,
      nameLocation: 'middle',
      nameGap: 48,
    },
    series: [
      ...visibleComponents.map((component) => ({
        name: component.label,
        type: 'bar' as const,
        stack: 'daily-total',
        cursor: 'pointer',
        yAxisIndex: 0,
        barMaxWidth: 24,
        itemStyle: { color: component.color },
        emphasis: { focus: 'series' },
        data: compositions.map((composition) => composition[component.key]),
      })),
      {
        name: '30d average',
        type: 'line',
        yAxisIndex: 0,
        showSymbol: false,
        lineStyle: { width: 2, color: '#84cc16' },
        itemStyle: { color: '#84cc16' },
        data: chronological.map((row) => Math.round(row.avg_30d ?? 0)),
      },
    ],
  };
}

const DAILY_SCORE_COMPONENTS: ReadonlyArray<{
  key: DailyScoreContributionCategory;
  label: string;
  color: string;
}> = [
  { key: 'steps', label: 'Steps', color: '#60a5fa' },
  { key: 'run', label: 'Run', color: '#2563eb' },
  { key: 'bike', label: 'Bike', color: '#1e3a8a' },
  { key: 'swim', label: 'Swim', color: '#7dd3fc' },
  { key: 'workout', label: 'Workout', color: '#8b5cf6' },
  { key: 'rowing', label: 'Rowing', color: '#14b8a6' },
  { key: 'sup', label: 'SUP', color: '#22c55e' },
  { key: 'hiit', label: 'HIIT', color: '#f97316' },
  { key: 'bonus', label: 'Bonus', color: '#ec4899' },
  { key: 'unattributed', label: 'Unattributed', color: '#94a3b8' },
];

function dailyScoreComposition(row: DailySummaryRow): Record<DailyScoreContributionCategory, number> {
  const composition = Object.fromEntries(
    DAILY_SCORE_COMPONENTS.map((component) => [component.key, 0]),
  ) as Record<DailyScoreContributionCategory, number>;
  for (const [rawCategory, rawPoints] of Object.entries(row.score_contributions ?? {})) {
    const points = Number(rawPoints);
    if (!Number.isFinite(points)) continue;
    const category = isDailyScoreContributionCategory(rawCategory) ? rawCategory : 'unattributed';
    composition[category] += points;
  }

  const attributedTotal = DAILY_SCORE_COMPONENTS.reduce((sum, component) => sum + composition[component.key], 0);
  const officialTotal = Number(row.total_points);
  if (Number.isFinite(officialTotal)) composition.unattributed += officialTotal - attributedTotal;
  return composition;
}

function isDailyScoreContributionCategory(value: string): value is DailyScoreContributionCategory {
  return DAILY_SCORE_COMPONENTS.some((component) => component.key === value);
}

export function dailyLogRowAtChartIndex(
  rows: readonly DailySummaryRow[],
  dataIndex: number,
): DailySummaryRow | undefined {
  return Number.isInteger(dataIndex) && dataIndex >= 0
    ? completedChartRows(rows).reverse()[dataIndex]
    : undefined;
}

// The current local day is still accumulating. Keep it in the table, while
// chart points and click targets share precisely the same completed-day rows.
function completedChartRows(rows: readonly DailySummaryRow[]): DailySummaryRow[] {
  const today = localCalendarDate();
  return rows.filter((row) => row.metric_date < today);
}

export function formatDailyCellNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number)
    : String(value);
}

export function compareDailyNumbers(valueA: unknown, valueB: unknown): number {
  const a = Number(valueA);
  const b = Number(valueB);
  const safeA = Number.isFinite(a) ? a : 0;
  const safeB = Number.isFinite(b) ? b : 0;
  return safeA - safeB;
}

export function formatDailyMeters(value: unknown, fractionDigits = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const meters = Number(value);
  return Number.isFinite(meters)
    ? `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: fractionDigits })} km`
    : String(value);
}

export function dailyScoreStatusLabel(value: unknown): string {
  if (value === 'imported') return 'Imported ledger';
  if (value === 'calculated') return 'Calculated';
  if (value === 'manual') return 'Manual edit';
  return String(value ?? '—');
}

