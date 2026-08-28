import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scoreFromImportedLedger } from '@sportos/domain';
import { createDb } from '../pool.js';
import { LEGACY_ACCOUNT_ID, withAccountContext } from '../ownership-context.js';
import { DailyRepository } from './daily.repository.js';
import { DailyScoringRepository } from './daily-scoring.repository.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

const noLedgerDate = '2097-05-18';
const importedDate = '2097-05-19';

databaseDescribe('DailyScoringRepository database integration', () => {
  let db: TestDatabase;

  beforeAll(() => { db = createDb(requireTestDatabaseUrl()); });
  beforeEach(async () => { await reset(db); });
  afterAll(async () => {
    if (db) {
      await reset(db);
      await db.destroy();
    }
  });

  it('creates a calculated row from Strava when no daily ledger exists', async () => {
    await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      await insertStravaRun(ownerDb, noLedgerDate, 'strava-run-1', 'strava-hash-1');
    });

    const breakdown = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).recalculateFromActivities(noLedgerDate),
    );

    expect(breakdown).toMatchObject({ date: noLedgerDate, scoreStatus: 'calculated' });
    expect(breakdown.score).toMatchObject({ appTotal: 6000, baseTotal: 5000, bonusTotal: 1000, excelTotal: null });
    expect(breakdown.activities).toHaveLength(1);
    expect(breakdown.activities[0]).toMatchObject({ source: 'strava', activityType: 'run' });
    expect(breakdown.ledger).toHaveLength(2);

    const daily = await db
      .selectFrom('daily_metrics')
      .select(['score_status', 'total_points', 'excel_all_points'])
      .where('metric_date', '=', noLedgerDate)
      .executeTakeFirstOrThrow();
    expect(daily).toMatchObject({ score_status: 'calculated', total_points: 6000, excel_all_points: null });
  });

  it('keeps an imported total in history and changes authority only after explicit recalculation', async () => {
    await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      const facts = {
        metricDate: importedDate,
        steps: 0,
        runM: 5000,
        bikeM: 0,
        swimM: 0,
        workoutPoints: 0,
        powerPoints: 0,
        excelAllPoints: 5000,
      };
      await new DailyRepository(ownerDb).persistDailyScore(
        facts,
        scoreFromImportedLedger(facts),
        undefined,
        { scoreStatus: 'imported', trigger: 'workbook_import' },
      );
      await insertStravaRun(ownerDb, importedDate, 'strava-run-2', 'strava-hash-2');
    });

    await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).recalculateFromActivities(importedDate),
    );

    const evidence = await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => ({
      daily: await ownerDb.selectFrom('daily_metrics').select(['score_status', 'total_points', 'excel_all_points']).where('metric_date', '=', importedDate).executeTakeFirstOrThrow(),
      snapshots: await ownerDb.selectFrom('daily_score_snapshots').select(['score_status', 'trigger', 'total_points']).where('metric_date', '=', importedDate).orderBy('created_at', 'asc').execute(),
    }));

    expect(evidence.daily).toMatchObject({ score_status: 'calculated', total_points: 6000, excel_all_points: 5000 });
    expect(evidence.snapshots.map((snapshot) => ({ status: snapshot.score_status, trigger: snapshot.trigger, total: snapshot.total_points }))).toEqual([
      { status: 'imported', trigger: 'workbook_import', total: 5000 },
      { status: 'calculated', trigger: 'manual_recalculation', total: 6000 },
    ]);
  });
});

async function insertStravaRun(db: TestDatabase, activityDate: string, sourceActivityId: string, sourceRecordHash: string): Promise<void> {
  await db.insertInto('activities').values({
    source: 'strava',
    source_record_id: null,
    source_activity_id: sourceActivityId,
    source_record_hash: sourceRecordHash,
    activity_date: activityDate,
    start_time: new Date(`${activityDate}T08:00:00.000Z`),
    activity_type: 'run',
    subtype: 'outdoor',
    distance_m: 5000,
    duration_s: 1499,
    moving_time_s: 1490,
    steps: null,
    calories: null,
    avg_hr: null,
    max_hr: null,
    elevation_gain_m: null,
    avg_speed_mps: null,
    avg_pace_s_per_km: null,
    effort_points: null,
    notes: null,
    raw_payload_json: {},
  }).execute();
}

async function reset(db: TestDatabase): Promise<void> {
  await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
    await ownerDb.deleteFrom('score_ledger').where('metric_date', 'in', [noLedgerDate, importedDate]).execute();
    await ownerDb.deleteFrom('daily_metrics').where('metric_date', 'in', [noLedgerDate, importedDate]).execute();
    await ownerDb.deleteFrom('activities').where('activity_date', 'in', [noLedgerDate, importedDate]).execute();
  });
}

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) throw new Error('SPORTOS_TEST_DATABASE_URL is required for database integration tests.');
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) {
    throw new Error('SPORTOS_TEST_DATABASE_URL must target a database whose name ends in _test or -test.');
  }
  return testDatabaseUrl;
}
