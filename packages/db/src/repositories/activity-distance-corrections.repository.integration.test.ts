import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import type { Database } from '../schema.js';
import {
  ActivityDistanceCorrectionConflictError,
  ActivityDistanceCorrectionUnsupportedError,
  ActivityDistanceCorrectionsRepository,
} from './activity-distance-corrections.repository.js';
import { ActivitiesRepository } from './activities.repository.js';

const databaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

databaseDescribe('audited activity distance corrections', () => {
  it('keeps corrections owner-scoped, effective, idempotent and append-only', async () => rollbackFixture(async (db) => {
    const owner = await account(db);
    const foreign = await account(db);
    const activity = await insertSwim(db, owner, 'indoor', 1025);
    const openWater = await insertSwim(db, owner, 'outdoor', 1000);
    const saved = await withAccountContext(db, owner, (scoped) => new ActivityDistanceCorrectionsRepository(scoped)
      .save(activity, 1000, 'First two rounds are one', null));
    expect(saved).toMatchObject({ changed: true, correction: { effectiveDistanceM: 1000, recordedDistanceM: 1025, revision: 1 } });

    expect(await withAccountContext(db, owner, (scoped) => new ActivitiesRepository(scoped).get(activity))).toMatchObject({ distance_m: 1000 });
    const raw = await withAccountContext(db, owner, (scoped) => scoped.selectFrom('activities').select('distance_m').where('id', '=', activity).executeTakeFirst());
    expect(raw?.distance_m === null || raw?.distance_m === undefined ? null : Number(raw.distance_m)).toBe(1025);
    expect(await withAccountContext(db, foreign, (scoped) => new ActivityDistanceCorrectionsRepository(scoped).current(activity))).toBeNull();
    expect(await withAccountContext(db, foreign, (scoped) => new ActivityDistanceCorrectionsRepository(scoped)
      .save(activity, 1000, 'foreign', null))).toBeNull();

    const repeat = await withAccountContext(db, owner, (scoped) => new ActivityDistanceCorrectionsRepository(scoped)
      .save(activity, 1000, 'First two rounds are one', 1));
    expect(repeat).toMatchObject({ changed: false, correction: { revision: 1 } });
    await expect(withAccountContext(db, owner, (scoped) => new ActivityDistanceCorrectionsRepository(scoped)
      .save(activity, 999, 'stale', null))).rejects.toBeInstanceOf(ActivityDistanceCorrectionConflictError);

    const reset = await withAccountContext(db, owner, (scoped) => new ActivityDistanceCorrectionsRepository(scoped).reset(activity, 1));
    expect(reset).toMatchObject({ changed: true, correction: null });
    expect(await withAccountContext(db, owner, (scoped) => new ActivityDistanceCorrectionsRepository(scoped).reset(activity, null)))
      .toMatchObject({ changed: false, correction: null });
    const afterReset = await withAccountContext(db, owner, (scoped) => new ActivityDistanceCorrectionsRepository(scoped)
      .save(activity, 1000, 'Corrected again', null));
    expect(afterReset).toMatchObject({ changed: true, correction: { revision: 3 } });

    const history = await withAccountContext(db, owner, (scoped) => scoped.selectFrom('activity_distance_correction_history')
      .select(['action', 'revision']).where('activity_id', '=', activity).orderBy('revision').execute());
    expect(history).toEqual([{ action: 'save', revision: 1 }, { action: 'reset', revision: 2 }, { action: 'save', revision: 3 }]);
    await expect(withAccountContext(db, owner, (scoped) => new ActivityDistanceCorrectionsRepository(scoped).save(openWater, 900, 'not a pool', null)))
      .rejects.toBeInstanceOf(ActivityDistanceCorrectionUnsupportedError);
  }), 30_000);
});

async function account(db: Kysely<Database>) {
  return (await db.insertInto('accounts').values({ display_name: `Correction ${randomUUID()}`, email: null, status: 'active' })
    .returning('id').executeTakeFirstOrThrow()).id;
}

async function insertSwim(db: Kysely<Database>, owner: string, subtype: 'indoor' | 'outdoor', distance: number) {
  return withAccountContext(db, owner, async (scoped) => (await scoped.insertInto('activities').values({
    source: 'strava', activity_type: 'swim', subtype, activity_date: '2095-10-21',
    distance_m: distance, duration_s: 1105, moving_time_s: 1099, avg_pace_s_per_km: 1072.2,
  }).returning('id').executeTakeFirstOrThrow()).id);
}

async function rollbackFixture(run: (db: Kysely<Database>) => Promise<void>) {
  const db = createDb(databaseUrl!);
  try {
    await db.connection().execute(async (connection) => {
      await sql`begin`.execute(connection);
      try {
        await run(connection);
      } finally {
        await sql`rollback`.execute(connection);
      }
    });
  } finally {
    await db.destroy();
  }
}
