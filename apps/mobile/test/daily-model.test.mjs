import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailySummaryPath, scoreBreakdownPath, formatPoints, scoreAuthority,
  contributionRows, mergeDays, todayCoverage, sourceNames, safeActivityType, projectDetail,
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

test('day detail only retains allowed fields, leaves imported/manual official totals intact', () => {
  const privateSource = { rawJson: { accountId: 'fixture-secret' }, filename: 'fixture-private.xlsx' };
  const raw = {
    date: '2026-10-27', recomputedAt: '2026-10-27T10:00:00Z', scoreStatus: 'manual',
    score: { appTotal: -12, baseTotal: -7, bonusPoints: -5, ledgerTotal: 0,
      excelTotal: 30, delta: -42, privateSource },
    facts: { steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0,
      stepsCalculation: { source: 'manual', resolvedSteps: 0, sourceRecordId: 'secret' } },
    ledger: [{ id: 'l1', points: -5, reason: 'sensitive', rule: { name: 'Penalty', activityType: 'bonus',
      description: 'private rule' }, activity: { id: 'a1', notes: 'secret notes' } }],
    activities: [{ id: 'a1', activityType: 'run', source: 'strava', sourceRecord: privateSource }],
    sourceRecords: [privateSource], sourceRecord: privateSource, garminObservations: [privateSource],
  };
  const result = projectDetail(raw);
  assert.equal(result.status, 'manual');
  assert.equal(result.score.appTotal, -12);
  assert.equal(result.score.ledgerTotal, 0);
  assert.equal(result.facts.steps, 0);
  assert.deepEqual(result.ledger, [{ id: 'l1', name: 'Penalty', type: 'bonus', points: -5 }]);
  assert.equal(result.activityCount, 1);
  const json = JSON.stringify(result);
  assert.equal(json.includes('fixture-secret'), false);
  assert.equal(json.includes('fixture-private'), false);
  assert.equal(json.includes('sensitive'), false);
  assert.equal(json.includes('sourceRecordId'), false);
  assert.equal(Object.hasOwn(result.score, 'privateSource'), false);
});
test('missing and imported day presentation is honest', () => {
  assert.deepEqual(mergeDays([], []), []);
  assert.equal(scoreAuthority('imported'), 'Imported score');
  const row = projectDetail({
    date: '2026-10-26', recomputedAt: '2026-10-26T00:00:00Z',
    scoreStatus: 'imported',
    score: { appTotal: 500, baseTotal: 500, bonusPoints: 0, ledgerTotal: 0, excelTotal: 500, delta: 0 },
    facts: { steps: 1000, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0 },
    ledger: [], activities: [],
  });
  assert.equal(row.score.appTotal, 500);
  assert.deepEqual(row.ledger, []);
});
