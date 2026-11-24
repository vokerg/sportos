import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withAccountContext } from '@sportos/db';
import type { DbProvider } from '../db.provider.js';
import { PersonalRecordsController } from './personal-records.controller.js';

const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
const date = '2095-02-14';

integration('account-scoped personal records', () => {
  let db: ReturnType<typeof createDb>;

  beforeAll(() => { db = createDb(url!); });
  afterAll(async () => { await db?.destroy(); });

  it('returns the authenticated owner’s qualifying results and canonical daily highs', async () => {
    const owner = await createAccount();
    const other = await createAccount();
    const swimId = await withAccountContext(db, owner.id, async scoped => {
      const swim = await scoped.insertInto('activities').values([
        { source: 'strava', activity_type: 'swim', activity_date: date, distance_m: 990, duration_s: 1000, moving_time_s: 950 },
        { source: 'strava', activity_type: 'swim', activity_date: date, distance_m: 1011, duration_s: 900 },
        { source: 'strava', activity_type: 'swim', activity_date: '2095-02-15', distance_m: 1000, duration_s: 800 },
        { source: 'strava', activity_type: 'bike', activity_date: date, distance_m: 20_050, duration_s: 2400 },
        { source: 'strava', activity_type: 'bike', activity_date: date, distance_m: 20_000, moving_time_s: 1200 },
      ]).returning('id').execute();
      await scoped.insertInto('performance_events').values({
        source: 'run_db_xlsx', event_date: date, distance_m: 5000, duration_s: 1300, pace_s_per_km: 260,
        is_treadmill: false, is_race: false, is_pr_marker: false, tags: [],
        source_record_hash: createHash('sha256').update(randomUUID()).digest('hex'),
      }).execute();
      await scoped.insertInto('daily_metrics').values({
        metric_date: date, steps: 1000, run_m: 0, bike_m: 20_050, swim_m: 990,
        workout_points: 0, base_points: 27_000, bonus_points: 0, total_points: 27_000,
      }).execute();
      return swim[0]!.id;
    });
    await withAccountContext(db, other.id, scoped => scoped.insertInto('activities').values({
      source: 'strava', activity_type: 'swim', activity_date: date, distance_m: 1000, duration_s: 600,
    }).execute());
    const provider: Pick<DbProvider, 'withAccount'> = {
      withAccount: (accountId, callback) => withAccountContext(db, accountId, callback),
    };
    const controller = new PersonalRecordsController(provider as DbProvider);

    const result = await controller.records({ to: date }, owner);
    expect(result.through).toBe(date);
    expect(result.daily).toContainEqual({ metric: 'score', windowDays: 1, period: 'all', date, value: 27_000, recordedDays: 1 });
    expect(result.running).toEqual([{ targetDistanceM: 5000, durationS: 1300, date, source: 'excel', activityId: null }]);
    expect(result.cycling).toEqual([expect.objectContaining({ targetDistanceM: 20_000, durationS: 2400, distanceM: 20_050 })]);
    expect(result.swimming).toEqual([{ sport: 'swim', targetDistanceM: 1000, activityId: swimId, distanceM: 990, durationS: 1000, date }]);
    expect(await controller.records({ to: date }, other)).toMatchObject({
      daily: [], cycling: [], running: [],
      swimming: [expect.objectContaining({ durationS: 600 })],
    });
    expect(() => controller.records({ to: date, ownerId: other.id }, owner)).toThrow();
  });

  async function createAccount() {
    const displayName = 'Synthetic personal records ' + randomUUID();
    const row = await db.insertInto('accounts').values({ display_name: displayName, email: null, status: 'active' })
      .returning('id').executeTakeFirstOrThrow();
    return { id: row.id, displayName, email: null };
  }
});
