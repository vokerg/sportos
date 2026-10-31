import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { PaceSpeedTrendsRepository } from './pace-speed-trends.repository.js';

const databaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('pace and speed trends on canonical owner-scoped activities', () => {
  let db: TestDatabase;
  const owners: string[] = [];
  beforeAll(() => { db = createDb(databaseUrl!); });
  afterAll(async () => {
    for (const owner of owners) await withAccountContext(db, owner, scoped => scoped.deleteFrom('activities').execute());
    if (owners.length) await db.deleteFrom('accounts').where('id', 'in', owners).execute();
    await db.destroy();
  });

  it('weights by distance, excludes slow activities only from the average and isolates accounts', async () => {
    const a = await account();
    const b = await account();
    owners.push(a, b);
    await insert(a, 'run', '2095-02-14', 10_000, 3000);
    await insert(a, 'run', '2095-02-15', 2_000, 480);
    await insert(a, 'run', '2095-02-16', 3_000, 1260);
    await insert(b, 'run', '2095-02-15', 8_000, 1600);
    const query = { from: '2095-02-01', to: '2095-02-28', sport: 'run', granularity: 'monthly', threshold: 360 } as const;
    const read = (owner: string, threshold: number | null) => withAccountContext(db, owner, scoped =>
      new PaceSpeedTrendsRepository(scoped).read({ ...query, threshold }));
    const filtered = (await read(a, 360)).buckets[0]!;
    expect(filtered).toMatchObject({ totalDistanceM: 15000, includedDistanceM: 12000, activities: 3, includedActivities: 2 });
    expect(filtered.value).toBeCloseTo(290, 8);
    const unfiltered = (await read(a, null)).buckets[0]!;
    expect(unfiltered.includedDistanceM).toBe(15000);
    expect(unfiltered.value).toBeCloseTo(316, 8);
    expect((await read(b, 360)).buckets[0]).toMatchObject({ totalDistanceM: 8000, includedDistanceM: 8000, activities: 1, value: 200 });
  });

  it('aggregates bike speed and swim pace in the correct units', async () => {
    const owner = await account();
    owners.push(owner);
    await insert(owner, 'bike', '2095-03-10', 20_000, 3600);
    await insert(owner, 'bike', '2095-03-11', 10_000, 1200);
    await insert(owner, 'swim', '2095-03-12', 1000, 1200);
    const read = (sport: 'bike' | 'swim', threshold: number | null) => withAccountContext(db, owner, scoped =>
      new PaceSpeedTrendsRepository(scoped).read({ from: '2095-03-01', to: '2095-03-31', sport, granularity: 'monthly', threshold }));
    const bike = (await read('bike', null)).buckets[0]!;
    expect(bike.value).toBeCloseTo(22.5, 8);
    const fastBike = (await read('bike', 25)).buckets[0]!;
    expect(fastBike).toMatchObject({ totalDistanceM: 30000, includedDistanceM: 10000, includedActivities: 1 });
    expect(fastBike.value).toBeCloseTo(30, 8);
    expect((await read('swim', 180)).buckets[0]).toMatchObject({ totalDistanceM: 1000, includedDistanceM: 1000, value: 120 });
  });

  async function account() {
    return (await db.insertInto('accounts').values({ display_name: 'Trends ' + randomUUID(), email: null, status: 'active' })
      .returning('id').executeTakeFirstOrThrow()).id;
  }

  async function insert(owner: string, sport: 'run' | 'bike' | 'swim', day: string, metres: number, seconds: number) {
    return withAccountContext(db, owner, scoped => scoped.insertInto('activities').values({
      source: 'manual', activity_type: sport, subtype: null,
      activity_date: day, distance_m: metres, duration_s: seconds, moving_time_s: seconds,
      avg_pace_s_per_km: sport === 'bike' ? null : seconds * 1000 / metres,
      avg_speed_mps: sport === 'bike' ? metres / seconds : null,
    }).execute());
  }
});
