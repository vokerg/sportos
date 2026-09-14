import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { DynamicsRepository } from './dynamics.repository.js';

const ownerDatabaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = ownerDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('dynamics account isolation integration', () => {
  let db: TestDatabase;
  const accountIds: string[] = [];

  beforeAll(() => { db = createDb(ownerDatabaseUrl!); });
  afterAll(async () => {
    if (!db) return;
    for (const accountId of accountIds) {
      await withAccountContext(db, accountId, (ownerDb) => ownerDb.deleteFrom('daily_metrics').where('metric_date', 'like', '2096-%').execute());
    }
    if (accountIds.length) await db.deleteFrom('accounts').where('id', 'in', accountIds).execute();
    await db.destroy();
  });

  it('returns only the current account rows for the same dates', async () => {
    const accountA = await createAccount(db, 'Dynamics A');
    const accountB = await createAccount(db, 'Dynamics B');
    accountIds.push(accountA, accountB);
    await withAccountContext(db, accountA, (ownerDb) => ownerDb.insertInto('daily_metrics').values(dailyRow('2096-01-02', 111)).execute());
    await withAccountContext(db, accountB, (ownerDb) => ownerDb.insertInto('daily_metrics').values(dailyRow('2096-01-02', 222)).execute());

    const rowsA = await withAccountContext(db, accountA, (ownerDb) => new DynamicsRepository(ownerDb).listDailyRows('2096-01-01', '2096-01-31'));
    const rowsB = await withAccountContext(db, accountB, (ownerDb) => new DynamicsRepository(ownerDb).listDailyRows('2096-01-01', '2096-01-31'));
    expect(rowsA.map((row) => row.score)).toEqual([111]);
    expect(rowsB.map((row) => row.score)).toEqual([222]);
    expect(await new DynamicsRepository(db).listDailyRows('2096-01-01', '2096-01-31')).toEqual([]);
  });
});

async function createAccount(db: TestDatabase, displayName: string): Promise<string> {
  return (await db.insertInto('accounts').values({ display_name: `${displayName} ${randomUUID()}`, email: null, status: 'active' }).returning('id').executeTakeFirstOrThrow()).id;
}

function dailyRow(metricDate: string, total: number) {
  return { metric_date: metricDate, source_record_id: null, steps: 1_000, run_m: 5_000, bike_m: 0, swim_m: 0, workout_points: 0, power_points: 0, base_points: total, bonus_points: 0, total_points: total, excel_all_points: null, excel_row_hash: null };
}
