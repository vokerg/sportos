import type { EChartsCoreOption } from 'echarts/core';
import type { DynamicsMetric, RollingDynamicsMeasure, RollingDynamicsResponse, RollingWindow, ScoreContributionCategory } from './features/dynamics/model/dynamics.models';

export const ROLLING_AGGREGATE_METRICS = ['run', 'swim', 'bike', 'steps', 'score', 'bonus', 'workout'] as const satisfies readonly DynamicsMetric[];
export type RollingAggregateMetric = typeof ROLLING_AGGREGATE_METRICS[number];

export interface RollingAggregateRow {
  date: string;
  values: Partial<Record<RollingAggregateMetric, number | null>>;
  complete: boolean;
}

export function buildRollingAggregateRows(
  responses: Partial<Record<RollingAggregateMetric, RollingDynamicsResponse>>,
  window: RollingWindow,
): RollingAggregateRow[] {
  const source = responses[ROLLING_AGGREGATE_METRICS[0]];
  if (!source) return [];
  return source.points.map((point) => {
    const values = Object.fromEntries(ROLLING_AGGREGATE_METRICS.map((metric) => [
      metric,
      responses[metric]?.points.find((candidate) => candidate.date === point.date)?.windows[window]?.calendarDayAverage ?? null,
    ])) as Partial<Record<RollingAggregateMetric, number | null>>;
    const complete = ROLLING_AGGREGATE_METRICS.every((metric) =>
      responses[metric]?.points.find((candidate) => candidate.date === point.date)?.windows[window]?.complete ?? false,
    );
    return { date: point.date, values, complete };
  });
}

const WINDOW_COLORS: Record<RollingWindow, string> = {
  7: '#f59e0b', 20: '#db2777', 30: '#2854d9', 60: '#7c3aed', 365: '#059669',
};

export const SCORE_CONTRIBUTION_LABELS: Record<ScoreContributionCategory, string> = {
  steps: 'Steps', run: 'Run', bike: 'Bike', swim: 'Swim', workout: 'Workout', rowing: 'Rowing', sup: 'SUP', hiit: 'HIIT', bonus: 'Bonus',
};

const SCORE_CONTRIBUTION_COLORS: Record<ScoreContributionCategory, string> = {
  steps: '#60a5fa', run: '#2563eb', bike: '#1e3a8a', swim: '#7dd3fc', workout: '#8b5cf6', rowing: '#14b8a6', sup: '#22c55e', hiit: '#f97316', bonus: '#ec4899',
};

export function rollingDynamicsChartOptions(
  response: RollingDynamicsResponse | null,
  measure: RollingDynamicsMeasure,
): EChartsCoreOption {
  if (!response) return {};
  const activeDays = measure === 'activeDays';
  const unit = activeDays ? 'days' : displayUnit(response.unit);
  return {
    color: response.windows.map((window) => WINDOW_COLORS[window]),
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) => activeDays ? formatDays(value) : formatDisplayedValue(value, response.unit),
    },
    legend: { bottom: 0 },
    grid: { left: 44, right: 24, top: 28, bottom: 58, containLabel: true },
    xAxis: { type: 'category', data: response.points.map((point) => point.date), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', name: unit },
    series: response.windows.map((window) => ({
      name: `${window}d ${measure === 'total' ? 'total' : measure === 'activeDays' ? 'active days' : 'avg/day'}`,
      type: 'line',
      showSymbol: response.points.length <= 60,
      connectNulls: false,
      data: response.points.map((point) => activeDays
        ? point.windows[window]?.activeDays ?? null
        : displayValue(point.windows[window]?.[rollingMeasure(measure)] ?? null, response.unit)),
    })),
  };
}

export function scoreContributionChartOptions(response: RollingDynamicsResponse | null, window: RollingWindow = response?.windows[0] ?? 30): EChartsCoreOption {
  if (!response) return {};
  const contribution = response.scoreContributions[window];
  if (!contribution) return {};
  return {
    color: contribution.categories.map((category) => SCORE_CONTRIBUTION_COLORS[category]),
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) ? `${numericValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} pts/day` : '—';
      },
    },
    legend: { bottom: 0, data: contribution.categories.map((category) => SCORE_CONTRIBUTION_LABELS[category]) },
    grid: { left: 48, right: 24, top: 28, bottom: 68, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: contribution.points.map((point) => point.date), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', name: 'pts/day', min: 0, splitLine: { lineStyle: { type: 'dashed', color: '#d7dce5' } } },
    series: contribution.categories.map((category) => ({
      name: SCORE_CONTRIBUTION_LABELS[category],
      type: 'line',
      stack: 'score-contribution',
      smooth: 0.35,
      showSymbol: false,
      lineStyle: { width: 1 },
      areaStyle: { opacity: 0.9 },
      emphasis: { focus: 'series' },
      data: contribution.points.map((point) => point.contributions[category] ?? 0),
    })),
  };
}

export function formatRollingValue(value: number | null | undefined, unit: RollingDynamicsResponse['unit']): string {
  if (value === null || value === undefined) return '—';
  const displayed = displayValue(value, unit)!;
  return formatDisplayedValue(displayed, unit);
}

export function formatRollingMeasureValue(
  value: number | null | undefined,
  measure: RollingDynamicsMeasure,
  unit: RollingDynamicsResponse['unit'],
): string {
  return measure === 'activeDays' ? formatDays(value) : formatRollingValue(value, unit);
}

function formatDisplayedValue(value: unknown, unit: RollingDynamicsResponse['unit']): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '—';
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: unit === 'metres' ? 2 : 1 }).format(numericValue);
  return unit === 'metres' ? `${formatted} km` : formatted;
}

export function rollingMeasure(measure: RollingDynamicsMeasure): 'total' | 'calendarDayAverage' | 'activeDays' {
  return measure === 'total' ? 'total' : measure === 'activeDays' ? 'activeDays' : 'calendarDayAverage';
}

function formatDays(value: unknown): string {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `${numericValue.toLocaleString()} days` : '—';
}

function displayValue(value: number | null, unit: RollingDynamicsResponse['unit']): number | null {
  return value === null ? null : unit === 'metres' ? value / 1_000 : value;
}

function displayUnit(unit: RollingDynamicsResponse['unit']): string {
  return unit === 'metres' ? 'km' : unit;
}
