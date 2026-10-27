import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailySummaryPath, scoreBreakdownPath, formatPoints, scoreAuthority,
  contributionRows, mergeDays, todayCoverage, sourceNames, safeActivityType,
} from '../src/daily/model.mjs';

test('date-only daily requests use exact local dates, not UTC timestamps', () => {
  assert.equal(dailySummaryPath({ from: '2026-10-27', to: '2026-10-27', limit: 1 }),
    '/daily/summary?from=2026-10-27&to=2026-10-27&limit=1');
  assert.equal(scoreBreakdownPath('2024-02-29'), '/daily/2024-02-29/score-breakdown');
  assert.throws(() => dailySummaryPath({ to: '2025-02-29' }));
  assert.throws(() => scoreBreakdownPath('2026-10-27T00:00:00Z'));
  assert.throws(() => dailySummaryPath({ limit: 10001 }));
});
test('zero, negative, positive and missing scores remain distinct', () => {
  assert.equal(formatPoints(0), '0');
  assert.equal(formatPoints(-275, true), '-275');
  assert.equal(formatPoints(1234, true), '+1,234');
  assert.equal(formatPoints(undefined), '—');
  assert.equal(scoreAuthority('imported'), 'Imported score');
  assert.equal(scoreAuthority('manual'), 'Manual edit');
  assert.equal(scoreAuthority('calculated'), 'Calculated score');
});
test('contribution categories are server values and include negative/unattributed without invention', () => {
  assert.deepEqual(contributionRows({ run: 100, bonus: -5, unattributed: 2 }),
    [{ key: 'run', label: 'Running', points: 100 },
     { key: 'bonus', label: 'Bonus', points: -5 },
     { key: 'unattributed', label: 'Unattributed', points: 2 }]);
  assert.deepEqual(contributionRows(undefined), []);
  assert.deepEqual(contributionRows({ steps: Number.NaN }), []);
});
test('history pagination dedupes by calendar date and retains latest fetched rows', () => {
  const a = { metric_date: '2026-10-27', total_points: 0 };
  const b = { metric_date: '2026-10-26', total_points: -10 };
  assert.deepEqual(mergeDays([a], [a, b]), [a, b]);
  assert.equal(todayCoverage('2026-10-27', '2026-10-27').includes('incomplete'), true);
  assert.equal(todayCoverage('2026-10-26', '2026-10-27').includes('Latest persisted'), true);
  assert.equal(sourceNames({ strava: false, garmin: false }), 'No linked provider evidence reported');
  assert.equal(safeActivityType('walk'), 'Walk');
});
