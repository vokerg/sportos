/** Sanitized CPU/payload benchmark. No database, account or personal values. */
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { buildDynamicsHistory, buildRollingDynamicsResponse, DYNAMICS_METRICS, ROLLING_WINDOWS } from '../apps/api/src/dynamics/dynamics.contracts.js';
import type { DynamicsDailyRow, ScoreContributionRow } from '@sportos/db';

const days = 3653;
const date = (i: number) => new Date(Date.UTC(2016, 0, i + 1)).toISOString().slice(0, 10);
const rows: DynamicsDailyRow[] = Array.from({ length: days }, (_, i) => ({
  metricDate: date(i), score: 1000 * (i % 17), steps: (i % 23) * 800,
  run: (i % 4) * 5000, bike: (i % 6) * 7000, swim: (i % 3) * 1000,
  workout: (i % 4) * 333, bonus: (i % 3) * 1000,
}));
const contributions: ScoreContributionRow[] = rows.flatMap((row) => [
  { metricDate: row.metricDate, activityType: 'run', points: row.score - row.bonus },
  { metricDate: row.metricDate, activityType: 'bonus', points: row.bonus },
]);
const to = date(days - 1);
const start = performance.now();
const history = buildDynamicsHistory(rows, to, contributions);
const historyMs = performance.now() - start;
const wire = JSON.stringify(history);
const legacyStart = performance.now();
const legacy = DYNAMICS_METRICS.map((metric) => buildRollingDynamicsResponse(rows, { from: date(0), to, metric, windows: [...ROLLING_WINDOWS] }, contributions));
const legacyMs = performance.now() - legacyStart;
console.log(JSON.stringify({ days, metrics: DYNAMICS_METRICS.length, windows: ROLLING_WINDOWS.length,
  historyMs: Math.round(historyMs), optimizedSeparateRequestsMs: Math.round(legacyMs),
  historyBytes: Buffer.byteLength(wire), historyGzipBytes: gzipSync(wire).byteLength,
  separateResponseBytes: Buffer.byteLength(JSON.stringify(legacy)), records: history.records.length }));
