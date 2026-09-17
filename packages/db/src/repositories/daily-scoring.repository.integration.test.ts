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
const manualDate = '2097-05-20';
const mixedDate = '2097-05-21';
const universalPaceDate = '2097-05-22';
const bonusOverrideDate = '2097-05-23';

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
    expect(breakdown.score).toMatchObject({ appTotal: 9500, baseTotal: 8500, bonusPoints: 1000, excelTotal: null });
    expect(breakdown.activities).toHaveLength(1);
    expect(breakdown.activities[0]).toMatchObject({ source: 'strava', activityType: 'run' });
    expect(breakdown.ledger).toHaveLength(2);

    const daily = await db
      .selectFrom('daily_metrics')
      .select(['score_status', 'total_points', 'excel_all_points'])
      .where('metric_date', '=', noLedgerDate)
      .executeTakeFirstOrThrow();
    expect(daily).toMatchObject({ score_status: 'calculated', total_points: 9500, excel_all_points: null });
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
        bonusPoints: 0,
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

    expect(evidence.daily).toMatchObject({ score_status: 'calculated', total_points: 9500, excel_all_points: 5000 });
    expect(evidence.snapshots.map((snapshot) => ({ status: snapshot.score_status, trigger: snapshot.trigger, total: snapshot.total_points }))).toEqual([
      { status: 'imported', trigger: 'workbook_import', total: 5000 },
      { status: 'calculated', trigger: 'manual_recalculation', total: 9500 },
    ]);
  });

  it('refreshes Strava distances without erasing manual workout points', async () => {
    await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      await new DailyScoringRepository(ownerDb).saveManualFacts(mixedDate, {
        steps: 0,
        runIndoorM: 0,
        runOutdoorM: 0,
        runUnspecifiedM: 0,
        bikeIndoorM: 0,
        bikeOutdoorM: 0,
        bikeUnspecifiedM: 0,
        swimM: 0,
        workoutPoints: 11_000,
        bonusPoints: 0,
      });
      await insertStravaRun(ownerDb, mixedDate, 'strava-mixed-1', 'strava-mixed-hash-1', 4_000, 2_000);
      await insertStravaRun(ownerDb, mixedDate, 'strava-mixed-2', 'strava-mixed-hash-2', 4_000, 2_000);
      await insertStravaRun(ownerDb, mixedDate, 'strava-mixed-3', 'strava-mixed-hash-3', 4_000, 2_000);
    });

    const breakdown = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).recalculateFromActivities(mixedDate),
    );

    expect(breakdown).toMatchObject({
      scoreStatus: 'calculated',
      facts: { runM: 12_000, runOutdoorM: 12_000, workoutPoints: 11_000 },
      score: { appTotal: 31_400, baseTotal: 31_400, bonusPoints: 0 },
    });
    expect(breakdown.ledger.map((entry) => entry.points).sort((a, b) => a - b)).toEqual([6_800, 6_800, 6_800, 11_000]);
  });

  it('awards the highest pace tier for each completed 5 km block', async () => {
    await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      await insertStravaRun(ownerDb, universalPaceDate, 'strava-run-17k', 'strava-hash-17k', 17_000, 4_079);
    });

    const breakdown = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).recalculateFromActivities(universalPaceDate),
    );

    expect(breakdown).toMatchObject({
      scoreStatus: 'calculated',
      facts: { runM: 17_000, runOutdoorM: 17_000 },
      score: { appTotal: 40_900, baseTotal: 28_900, bonusPoints: 12_000 },
    });
    expect(breakdown.ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleCode: 'run.pace.per5k.sub4.bonus', points: 12_000 }),
    ]));
  });

  it('replaces a manual bonus override when activities are recalculated', async () => {
    await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      await insertStravaRun(ownerDb, bonusOverrideDate, 'strava-bonus-run', 'strava-bonus-run-hash', 10_080, 2_988);
      await insertStravaBike(ownerDb, bonusOverrideDate, 'strava-bonus-bike', 'strava-bonus-bike-hash', 10_440, 19.92 / 3.6);
    });

    const calculated = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).recalculateFromActivities(bonusOverrideDate),
    );
    expect(calculated.score.bonusPoints).toBe(3_000);

    const manual = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).saveManualFacts(bonusOverrideDate, {
        steps: 0,
        runIndoorM: 0,
        runOutdoorM: 10_080,
        runUnspecifiedM: 0,
        bikeIndoorM: 0,
        bikeOutdoorM: 10_440,
        bikeUnspecifiedM: 0,
        swimM: 0,
        workoutPoints: 0,
        bonusPoints: 4_000,
      }),
    );
    expect(manual.score.bonusPoints).toBe(4_000);

    const recalculated = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).recalculateFromActivities(bonusOverrideDate),
    );
    expect(recalculated).toMatchObject({
      scoreStatus: 'calculated',
      score: { bonusPoints: 3_000 },
    });
  });

  it('stores manual facts, provenance, activities, and immutable score history', async () => {
    const input = {
      steps: 1000,
      runIndoorM: 1000,
      runOutdoorM: 3000,
      runUnspecifiedM: 1000,
      bikeIndoorM: 500,
      bikeOutdoorM: 1000,
      bikeUnspecifiedM: 500,
      swimM: 100,
      workoutPoints: 10,
      bonusPoints: 5,
    };
    const first = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).saveManualFacts(manualDate, input),
    );
    const second = await withAccountContext(
      db,
      LEGACY_ACCOUNT_ID,
      (ownerDb) => new DailyScoringRepository(ownerDb).saveManualFacts(manualDate, { ...input, steps: 2000 }),
    );

    expect(first).toMatchObject({
      scoreStatus: 'manual',
      facts: { runM: 5000, runIndoorM: 1000, runOutdoorM: 3000, runUnspecifiedM: 1000, bikeM: 2000, bikeIndoorM: 500, bikeOutdoorM: 1000, bikeUnspecifiedM: 500 },
    });
    expect(second).toMatchObject({ scoreStatus: 'manual', facts: { steps: 2000 } });
    const evidence = await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => ({
      daily: await ownerDb.selectFrom('daily_metrics').select(['score_status', 'source_record_id']).where('metric_date', '=', manualDate).executeTakeFirstOrThrow(),
      activities: await ownerDb.selectFrom('activities').select(['source', 'source_record_id']).where('activity_date', '=', manualDate).where('source', '=', 'manual').execute(),
      snapshots: await ownerDb.selectFrom('daily_score_snapshots').select(['score_status', 'trigger']).where('metric_date', '=', manualDate).execute(),
      batches: await ownerDb.selectFrom('import_batches').select(['source_kind', 'status']).where('source', '=', 'manual_daily_edit').execute(),
    }));
    expect(evidence.daily.score_status).toBe('manual');
    expect(evidence.daily.source_record_id).toEqual(expect.any(String));
    expect(evidence.activities.length).toBeGreaterThan(0);
    expect(evidence.activities.every((activity) => activity.source_record_id === evidence.daily.source_record_id)).toBe(true);
    expect(evidence.snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ score_status: 'manual', trigger: 'manual_edit' }),
    ]));
    expect(evidence.batches).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: 'manual', status: 'scored' }),
    ]));
  });
});

async function insertStravaRun(
  db: TestDatabase,
  activityDate: string,
  sourceActivityId: string,
  sourceRecordHash: string,
  distanceM = 5_000,
  durationS = 1_499,
): Promise<void> {
  await db.insertInto('activities').values({
    source: 'strava',
    source_record_id: null,
    source_activity_id: sourceActivityId,
    source_record_hash: sourceRecordHash,
    activity_date: activityDate,
    start_time: new Date(`${activityDate}T08:00:00.000Z`),
    activity_type: 'run',
    subtype: 'outdoor',
    distance_m: distanceM,
    duration_s: durationS,
    moving_time_s: durationS,
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

async function insertStravaBike(
  db: TestDatabase,
  activityDate: string,
  sourceActivityId: string,
  sourceRecordHash: string,
  distanceM: number,
  avgSpeedMps: number,
): Promise<void> {
  await db.insertInto('activities').values({
    source: 'strava',
    source_record_id: null,
    source_activity_id: sourceActivityId,
    source_record_hash: sourceRecordHash,
    activity_date: activityDate,
    start_time: new Date(`${activityDate}T10:00:00.000Z`),
    activity_type: 'bike',
    subtype: 'outdoor',
    distance_m: distanceM,
    duration_s: Math.round(distanceM / avgSpeedMps),
    moving_time_s: Math.round(distanceM / avgSpeedMps),
    steps: null,
    calories: null,
    avg_hr: null,
    max_hr: null,
    elevation_gain_m: null,
    avg_speed_mps: avgSpeedMps,
    avg_pace_s_per_km: null,
    effort_points: null,
    notes: null,
    raw_payload_json: {},
  }).execute();
}

async function reset(db: TestDatabase): Promise<void> {
  await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
    const dates = [noLedgerDate, importedDate, manualDate, mixedDate, universalPaceDate, bonusOverrideDate];
    await ownerDb.deleteFrom('score_ledger').where('metric_date', 'in', dates).execute();
    await ownerDb.deleteFrom('daily_metrics').where('metric_date', 'in', dates).execute();
    await ownerDb.deleteFrom('activities').where('activity_date', 'in', dates).execute();
    const batches = await ownerDb.selectFrom('import_batches').select('id').where('source', '=', 'manual_daily_edit').execute();
    if (batches.length > 0) {
      const ids = batches.map((batch) => batch.id);
      await ownerDb.deleteFrom('source_records').where('import_batch_id', 'in', ids).execute();
      await ownerDb.deleteFrom('import_batches').where('id', 'in', ids).execute();
    }
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
