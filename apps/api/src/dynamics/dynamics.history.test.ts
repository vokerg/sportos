import { describe, expect, it } from 'vitest';
import type { DynamicsDailyRow, ScoreContributionRow } from '@sportos/db';
import { buildDynamicsHistory, buildRollingDynamicsResponse, DYNAMICS_METRICS, ROLLING_WINDOWS } from './dynamics.contracts.js';

const date = (day: number) => new Date(Date.UTC(2023, 0, day)).toISOString().slice(0, 10);
const daily = (day: number, value = day % 23): DynamicsDailyRow => ({
  metricDate: date(day), score: value * 100, steps: value * 1000,
  run: value * 333, bike: value * 1300, swim: value * 31, workout: value * 10, bonus: value * 5,
});

const rows = Array.from({ length: 1150 }, (_, i) => i + 1).filter((i) => i % 11 !== 0).map((i) => daily(i));
const contributions: ScoreContributionRow[] = rows.map((row) => ({ metricDate: row.metricDate, activityType: 'run', points: row.score }));

describe('compact canonical Dynamics history', () => {
  it('matches independent calendar-window calculations for all metrics/windows with gaps, zeros, leap days and nonzero lookback', () => {
    const history = buildDynamicsHistory(rows, date(1150), contributions);
    for (const metric of DYNAMICS_METRICS) {
      const legacy = buildRollingDynamicsResponse(rows, { from: date(1000), to: date(1010), metric, windows: [...ROLLING_WINDOWS] }, contributions);
      for (const [i, point] of legacy.points.entries()) {
        const day = 1000 + i;
        const columnIndex = history.dates.indexOf(date(day));
        for (const window of ROLLING_WINDOWS) {
          const included = rows.filter((r) => r.metricDate >= date(day - window + 1) && r.metricDate <= date(day));
          const total = included.reduce((sum, r) => sum + r[metric], 0);
          expect(history.windows[window]?.totals[metric][columnIndex]).toBe(total);
          expect(history.windows[window]?.activeDays[metric][columnIndex]).toBe(included.filter((r) => r[metric] > 0).length);
          expect(point.windows[window]).toMatchObject({ total, calendarDayAverage: total / window, recordedDays: included.length, complete: included.length === window });
          expect(legacy.scoreContributions[window]?.points[i]?.total).toBeCloseTo(included.reduce((sum, r) => sum + r.score, 0) / window, 8);
        }
      }
    }
  });

  it('assigns year records by end date including prior-year lookback and handles historical record decreases', () => {
    const before = buildDynamicsHistory([daily(360, 100), daily(365, 1), daily(366, 20), daily(367, 1)], date(380));
    const record = (result: ReturnType<typeof buildDynamicsHistory>, period: string, window = 7) => result.records.find((r) => r.metric === 'steps' && r.period === period && r.windowDays === window);
    expect(record(before, '2024')).toMatchObject({ date: date(366), value: 121000 / 7, recordedDays: 3 });
    const after = buildDynamicsHistory([daily(360, 0), daily(365, 1), daily(366, 20), daily(367, 1)], date(380));
    expect(record(after, '2024')!.value).toBe(22000 / 7);
    expect(record(after, 'all', 1)).toMatchObject({ date: date(366), value: 20000 });
    expect(record(after, '2023', 1)!.value).toBe(1000);
    expect(after.records.some((r) => r.windowDays === 365)).toBe(false);
  });

  it('does not fabricate records or values without evidence; startup windows never rank as full-span records', () => {
    const empty = buildDynamicsHistory([], date(100));
    expect(empty.dates).toEqual([]); expect(empty.records).toEqual([]);
    const history = buildDynamicsHistory([daily(1, 0)], date(400));
    expect(history.windows[7]?.totals.run[7]).toBeNull();
    expect(history.records.find((r) => r.metric === 'run' && r.windowDays === 7 && r.period === 'all')).toMatchObject({ value: 0, date: date(7), recordedDays: 1 });
    expect(history.records.every((r) => r.recordedDays > 0)).toBe(true);
  });
});

it('keeps decimal-distance ties stable over long histories without floating point drift', () => {
  const decimalRows = Array.from({ length: 1000 }, (_, i) => ({ ...daily(i + 1), run: 0.1, bike: 0.2, swim: 0.29 }));
  const history = buildDynamicsHistory(decimalRows, date(1000));
  expect(history.windows[7]!.totals.run.slice(6).every((value) => value === 0.7)).toBe(true);
  expect(history.records.find((r) => r.metric === 'run' && r.windowDays === 7 && r.period === 'all')).toMatchObject({ date: date(7), value: 0.7 / 7 });
});
