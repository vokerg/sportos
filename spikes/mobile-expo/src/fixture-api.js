/**
 * Fixture-only canonical read for issue #186. This module makes no HTTP request,
 * has no real credentials, and must never be imported by apps/mobile (#188).
 *
 * @typedef {{kind: 'fixture', accountId: string}} FixtureSession
 */

const OWNER = 'synthetic-fixture-owner';

/** @type {Readonly<FixtureSession>} */
export const fixtureSession = Object.freeze({
  kind: 'fixture',
  accountId: OWNER,
});

const activities = Object.freeze([
  Object.freeze({ id: 'mock-run-1', type: 'run', distanceM: 5000, durationS: 1412, source: 'synthetic' }),
  Object.freeze({ id: 'mock-swim-1', type: 'swim', distanceM: 1000, durationS: 1380, source: 'synthetic' }),
]);

/**
 * Exercise "session required -> bounded owner-scoped read" shape without
 * communicating with SportOS's real API. The fixture owner is deliberately
 * not a UUID or user-provided authority.
 *
 * @param {FixtureSession | null | undefined} session
 * @returns {Promise<{source: 'fixture-only', activities: Array<{id: string, type: string, distanceM: number, durationS: number, source: string}>}>}
 */
export async function readFixtureActivities(session) {
  if (session?.kind !== 'fixture' || session.accountId !== OWNER) {
    throw new Error('Fixture access denied: no matching mock session.');
  }
  return {
    source: 'fixture-only',
    activities: activities.map((activity) => ({ ...activity })),
  };
}
