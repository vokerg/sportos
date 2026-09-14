import type { EChartsCoreOption } from 'echarts/core';
import type { DynamicsBucket, DynamicsMeasure, DynamicsMetric, DynamicsResponse } from './api.service';

export type DynamicsMode = 'absolute' | 'indexed';

export const DYNAMICS_LABELS: Record<DynamicsMetric, string> = {
  score: 'Official score',
  steps: 'Steps',
  run: 'Run',
  bike: 'Bike',
  swim: 'Swim',
  workout: 'Workout points',
  power: 'Power points',
};

const COLORS: Record<DynamicsMetric, string> = {
  score: '#2854d9', steps: '#d97706', run: '#059669', bike: '#7c3aed', swim: '#0284c7', workout: '#db2777', power: '#dc2626',
};

export function dynamicsChartOptions(
  response: DynamicsResponse | null,
  measure: DynamicsMeasure,
  mode: DynamicsMode,
): EChartsCoreOption {
  if (!response) return {};
  const units = response.metrics.map((metric) => displayUnit(response.metricUnits[metric]));
  const indexed = mode === 'indexed';
  const axes = indexed ? [{ type: 'value', name: 'Index (first non-zero = 100)' }] : response.metrics.map((metric, index) => ({
    type: 'value',
    name: `${DYNAMICS_LABELS[metric]} (${units[index]})`,
    position: index % 2 === 0 ? 'left' : 'right',
    offset: Math.floor(index / 2) * 56,
    axisLine: { show: true, lineStyle: { color: COLORS[metric] } },
    axisLabel: { color: COLORS[metric] },
  }));
  const leftAxes = indexed ? 1 : Math.ceil(response.metrics.length / 2);
  const rightAxes = indexed ? 0 : Math.floor(response.metrics.length / 2);

  return {
    color: response.metrics.map((metric) => COLORS[metric]),
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 48 + ((leftAxes - 1) * 56), right: 24 + (rightAxes * 56), top: 54, bottom: 56, containLabel: true },
    xAxis: { type: 'category', data: response.series.map((bucket) => bucket.key), axisLabel: { hideOverlap: true } },
    yAxis: axes,
    series: response.metrics.map((metric, index) => {
      const absolute = response.series.map((bucket) => displayValue(bucket, metric, measure, response.metricUnits[metric]));
      return {
        name: `${DYNAMICS_LABELS[metric]} · ${measure === 'total' ? 'total' : 'recorded-day avg'}${indexed ? '' : ` (${units[index]})`}`,
        type: 'line',
        smooth: false,
        connectNulls: false,
        showSymbol: response.series.length <= 60,
        yAxisIndex: indexed ? 0 : index,
        data: indexed ? indexedValues(absolute) : absolute,
      };
    }),
  };
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
