import type { EChartsCoreOption } from 'echarts/core';
import type { DynamicsMeasure, RollingDynamicsResponse, RollingWindow } from './api.service';

const WINDOW_COLORS: Record<RollingWindow, string> = {
  10: '#f59e0b', 20: '#db2777', 30: '#2854d9', 60: '#7c3aed', 365: '#059669',
};

export function rollingDynamicsChartOptions(
  response: RollingDynamicsResponse | null,
  measure: DynamicsMeasure,
): EChartsCoreOption {
  if (!response) return {};
  const unit = displayUnit(response.unit);
  return {
    color: response.windows.map((window) => WINDOW_COLORS[window]),
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 44, right: 24, top: 28, bottom: 58, containLabel: true },
    xAxis: { type: 'category', data: response.points.map((point) => point.date), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', name: unit },
    series: response.windows.map((window) => ({
      name: `${window}d ${measure === 'total' ? 'total' : 'avg/day'}`,
      type: 'line',
      showSymbol: response.points.length <= 60,
      connectNulls: false,
      data: response.points.map((point) => displayValue(point.windows[window]?.[rollingMeasure(measure)] ?? null, response.unit)),
    })),
  };
}

export function formatRollingValue(value: number | null | undefined, unit: RollingDynamicsResponse['unit']): string {
  if (value === null || value === undefined) return '—';
  const displayed = displayValue(value, unit)!;
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: unit === 'metres' ? 2 : 1 }).format(displayed);
  return unit === 'metres' ? `${formatted} km` : formatted;
}

export function rollingMeasure(measure: DynamicsMeasure): 'total' | 'calendarDayAverage' {
  return measure === 'total' ? 'total' : 'calendarDayAverage';
}

function displayValue(value: number | null, unit: RollingDynamicsResponse['unit']): number | null {
  return value === null ? null : unit === 'metres' ? value / 1_000 : value;
}

function displayUnit(unit: RollingDynamicsResponse['unit']): string {
  return unit === 'metres' ? 'km' : unit;
}
