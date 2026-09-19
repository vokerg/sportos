import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { ActivitiesRepository } from './activities.repository.js';

const databaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('canonical activities account isolation', () => {
  let db: TestDatabase;
  const owners: string[] = [];
  beforeAll(() => { db = createDb(databaseUrl!); });
  afterAll(async () => {
    for (const owner of owners) await withAccountContext(db, owner, (scoped) => scoped.deleteFrom('activities').execute());
    if (owners.length) await db.deleteFrom('accounts').where('id', 'in', owners).execute();
    await db.destroy();
  });

  it('filters canonical rows and hides foreign details through forced RLS', async () => {
    const ownerA = await account(db); const ownerB = await account(db);
    owners.push(ownerA, ownerB);
    const run = await insert(ownerA, 'run', 'strava', '2095-01-02', 5000);
    const bike = await insert(ownerA, 'bike', 'manual', '2095-01-03', 20000);
    const foreign = await insert(ownerB, 'swim', 'garmin', '2095-01-03', 1000);
    const query = { limit: 50, offset: 0 };
    const list = (owner: string, filters = {}) => withAccountContext(db, owner, (scoped) => new ActivitiesRepository(scoped).list({ ...query, ...filters }));
    expect((await list(ownerA)).items.map((item) => item.id)).toEqual([bike, run]);
    expect((await list(ownerA, { activityType: 'run' })).items.map((item) => item.id)).toEqual([run]);
    expect((await list(ownerA, { source: 'manual' })).items.map((item) => item.id)).toEqual([bike]);
    expect((await list(ownerA, { from: '2095-01-03', to: '2095-01-03' })).items.map((item) => item.id)).toEqual([bike]);
    expect((await list(ownerA)).summary).toMatchObject({ count: 2, distanceM: 25000 });
    expect(await withAccountContext(db, ownerA, (scoped) => new ActivitiesRepository(scoped).get(run))).toMatchObject({ id: run });
    expect(await withAccountContext(db, ownerA, (scoped) => new ActivitiesRepository(scoped).get(foreign))).toBeNull();
    expect(await withAccountContext(db, ownerB, (scoped) => new ActivitiesRepository(scoped).get(run))).toBeNull();
    expect((await list(ownerB)).items.map((item) => item.id)).toEqual([foreign]);
  });

  async function insert(owner: string, type: 'run' | 'bike' | 'swim', source: 'strava' | 'manual' | 'garmin', date: string, distanceM: number) {
    return withAccountContext(db, owner, async (scoped) => (await scoped.insertInto('activities').values({
      source, activity_type: type, activity_date: date, distance_m: distanceM, duration_s: 1800,
    }).returning('id').executeTakeFirstOrThrow()).id);
  }
});

async function account(db: TestDatabase) {
  return (await db.insertInto('accounts').values({ display_name: `Activities ${randomUUID()}`, email: null, status: 'active' }).returning('id').executeTakeFirstOrThrow()).id;
}
