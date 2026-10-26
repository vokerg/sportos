import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureSession, readFixtureActivities } from '../src/fixture-api.js';

test('fixture read denies missing mock session', async () => {
  await assert.rejects(readFixtureActivities(null), /access denied/);
});

test('fixture read denies other synthetic owners', async () => {
  await assert.rejects(
    readFixtureActivities({ kind: 'fixture', accountId: 'another-fixture-owner' }),
    /access denied/,
  );
});

test('fixture read is clearly nonproduction and returns defensive copies', async () => {
  const first = await readFixtureActivities(fixtureSession);
  assert.equal(first.source, 'fixture-only');
  assert.equal(first.activities.length, 2);
  assert.deepEqual(first.activities.map((activity) => activity.distanceM), [5000, 1000]);
  first.activities[0].distanceM = -1;
  const second = await readFixtureActivities(fixtureSession);
  assert.equal(second.activities[0].distanceM, 5000);
});
