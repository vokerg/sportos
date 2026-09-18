import type { EChartsCoreOption } from 'echarts/core';
import type { DailySummaryRow } from './api.service';
import { formatDate } from './date-time';

export type DailyLogSummaryState = 'loading' | 'loaded' | 'empty' | 'error';

export const QUICK_RANGE_VALUES = ['custom', '1m', '3m', '6m', 'ytd', '1y', '3y', 'all'] as const;
export type QuickRange = typeof QUICK_RANGE_VALUES[number];

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

export function quickRangeDates(
  range: Exclude<QuickRange, 'custom'>,
  today = new Date(),
): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  if (range === 'all') return { from: '', to: '' };
  if (range === 'ytd') return { from: `${to.slice(0, 4)}-01-01`, to };

  const months = range === '1m' ? 1 : range === '3m' ? 3 : range === '6m' ? 6 : range === '1y' ? 12 : 36;
  return { from: shiftCalendarMonths(to, months), to };
}

export function boundedAllTimeRange(
  to = new Date().toISOString().slice(0, 10),
  maxDays = 3_660,
): { from: string; to: string } {
  const from = new Date(`${to}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - (maxDays - 1));
  return { from: from.toISOString().slice(0, 10), to };
}

export function dailyLogChartOptions(rows: readonly DailySummaryRow[]): EChartsCoreOption {
  const chronological = [...rows].reverse();
  return {
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    grid: { left: 45, right: 20, top: 20, bottom: 55 },
    xAxis: {
      type: 'category',
      data: chronological.map((row) => formatDate(row.metric_date)),
      axisLabel: { hideOverlap: true },
    },
    yAxis: { type: 'value' },
    series: [
      { name: 'Total points', type: 'bar', cursor: 'pointer', data: chronological.map((row) => row.total_points) },
      { name: '30d average', type: 'line', data: chronological.map((row) => Math.round(row.avg_30d ?? 0)) },
    ],
  };
}

export function dailyLogRowAtChartIndex(
  rows: readonly DailySummaryRow[],
  dataIndex: number,
): DailySummaryRow | undefined {
  return Number.isInteger(dataIndex) && dataIndex >= 0
    ? rows[rows.length - 1 - dataIndex]
    : undefined;
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

function shiftCalendarMonths(value: string, months: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7)) - 1;
  const day = Number(value.slice(8, 10));
  const targetMonthIndex = month - months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();

  return `${targetYear.toString().padStart(4, '0')}-${(targetMonth + 1).toString().padStart(2, '0')}-${Math.min(day, daysInTargetMonth).toString().padStart(2, '0')}`;
}
