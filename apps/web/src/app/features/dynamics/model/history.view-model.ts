import { positiveMetricRange, relativePastelBackground } from '../../../shared/util/metric-heat';
import { ROLLING_AGGREGATE_METRICS } from './rolling-dynamics.view-model';
import type { DynamicsHistoryResponse, DynamicsMetric, RollingDynamicsResponse, RollingWindow } from './dynamics.models';

export function historyMetric(history: DynamicsHistoryResponse | null, metric: DynamicsMetric, windows: RollingWindow[]): RollingDynamicsResponse | null {
  if (!history) return null;
  return { range: history.range, metric, unit: metricUnit(metric), windows,
    points: history.dates.map((date, i) => ({ date, dailyValue: history.daily[metric][i] ?? null,
      windows: Object.fromEntries(windows.map((window) => {
        const column = history.windows[window];
        const total = column?.totals[metric][i] ?? null;
        const recordedDays = column?.recordedDays[i] ?? 0;
        return [window, { total, calendarDayAverage: total === null ? null : total / window,
          activeDays: column?.activeDays[metric][i] ?? null, recordedDays, windowDays: window, complete: recordedDays === window }];
      })),
    })), scoreContributions: Object.fromEntries(windows.map((window) => [window, history.scoreContributions[window]])) };
}
export function metricUnit(metric: DynamicsMetric): RollingDynamicsResponse['unit'] {
  return ['run', 'bike', 'swim'].includes(metric) ? 'metres' : metric === 'steps' ? 'steps' : 'points';
}

export interface IndexedDay { date: string; index: number }

export function historyHeatRanges(history: DynamicsHistoryResponse | null, windows: RollingWindow[], dates: IndexedDay[]) {
  return Object.fromEntries(windows.map((window) => [window,
    Object.fromEntries(ROLLING_AGGREGATE_METRICS.map((metric) => [metric,
      positiveMetricRange(dates.map(({ index }) => history?.windows[window]?.totals[metric][index]))]))]));
}

export function historyTableRows(history: DynamicsHistoryResponse | null, windows: RollingWindow[], dates: IndexedDay[], page: number, size: number, ranges: ReturnType<typeof historyHeatRanges>) {
  const visible = dates.slice(page * size, (page + 1) * size);
  return Object.fromEntries(windows.map((window) => {
    const columns = history?.windows[window];
    return [window, visible.map(({ date, index }) => ({ date, recordedDays: columns?.recordedDays[index] ?? 0,
      values: Object.fromEntries(ROLLING_AGGREGATE_METRICS.map((metric) => {
        const total = columns?.totals[metric][index];
        return [metric, total === null || total === undefined ? null : total / window];
      })),
      colors: Object.fromEntries(ROLLING_AGGREGATE_METRICS.map((metric) => [metric,
        relativePastelBackground(columns?.totals[metric][index], ranges[window]?.[metric] ?? null, '65, 150, 180') ?? 'transparent'])),
    }))];
  }));
}
