import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../pool.js';
import { CanonicalExportRepository } from './canonical-export.repository.js';

const testDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;
const metricDate = '2098-05-18';

databaseDescribe('CanonicalExportRepository database integration', () => {
  let db: TestDatabase;
  const createdBatchIds: string[] = [];

  beforeAll(() => { db = createDb(requireTestDatabaseUrl()); });
  beforeEach(async () => { await cleanup(db, createdBatchIds); });

  afterAll(async () => {
    if (db) {
      await cleanup(db, createdBatchIds);
      await db.destroy();
    }
  });

  it('exports canonical rows in stable order with traceable source and batch identifiers', async () => {
    const batch = await db.insertInto('import_batches').values({
      source: 'integration-export',
      source_kind: 'xlsx',
      filename: 'sanitized.xlsx',
      original_sha256: 'not-exported-upload-hash',
      status: 'scored',
      completed_at: new Date('2098-05-18T12:00:00.000Z'),
      metadata: {},
    }).returning('id').executeTakeFirstOrThrow();
    createdBatchIds.push(batch.id);

    const sourceRecord = await db.insertInto('source_records').values({
      import_batch_id: batch.id,
      source: 'daily-sheet',
      sheet_name: 'Daily',
      row_index: 2,
      source_record_key: 'Daily:2',
      row_hash: `row-${randomUUID()}`,
      raw_json: { secretFormula: '=SUM(A1:A2)' },
      normalized_entity_type: 'daily_metric',
      normalized_entity_id: null,
      status: 'normalized',
      errors: [],
      warnings: [],
    }).returning(['id', 'row_hash']).executeTakeFirstOrThrow();

    const activity = await db.insertInto('activities').values({
      source: 'my_sport_xlsx',
      source_record_id: sourceRecord.id,
      source_activity_id: null,
      source_record_hash: sourceRecord.row_hash,
      activity_date: metricDate,
      start_time: new Date('2098-05-18T08:00:00.000Z'),
      activity_type: 'run',
      subtype: 'outdoor',
      distance_m: 5000,
      duration_s: 1500,
      moving_time_s: 1490,
      steps: null,
      calories: null,
      avg_hr: null,
      max_hr: null,
      elevation_gain_m: null,
      avg_speed_mps: null,
      avg_pace_s_per_km: 300,
      effort_points: null,
      notes: 'Canonical note',
      raw_payload_json: { hidden: 'not exported' },
    }).returning('id').executeTakeFirstOrThrow();

    await db.insertInto('daily_metrics').values({
      metric_date: metricDate,
      source_record_id: sourceRecord.id,
      steps: 1000,
      run_m: 5000,
      bike_m: 0,
      swim_m: 0,
      workout_points: 0,
      power_points: 0,
      base_points: 5000,
      bonus_points: 0,
      total_points: 5000,
      excel_all_points: 5000,
      excel_row_hash: sourceRecord.row_hash,
    }).execute();

    const event = await db.insertInto('performance_events').values({
      activity_id: activity.id,
      source_record_id: sourceRecord.id,
      source_record_hash: sourceRecord.row_hash,
      source: 'run_db_xlsx',
      event_date: metricDate,
      distance_m: 5000,
      duration_s: 1500,
      pace_s_per_km: 300,
      is_treadmill: false,
      is_race: true,
      is_pr_marker: true,
      source_rank: 1,
      tags: ['race'],
      notes: 'Race event',
      raw_payload_json: { hidden: 'not exported' },
    }).returning('id').executeTakeFirstOrThrow();

    const bundle = await new CanonicalExportRepository(db).buildBundle(
      metricDate,
      metricDate,
      new Date('2098-05-19T00:00:00.000Z'),
    );

    expect(bundle.rowCounts).toEqual({ dailySummaries: 1, activities: 1, performanceEvents: 1 });
    expect(bundle.dailySummaries[0]).toMatchObject({
      metricDate,
      reconciliationStatus: 'exact',
      provenance: { status: 'available', sourceRecordId: sourceRecord.id, importBatchId: batch.id, filename: 'sanitized.xlsx' },
    });
    expect(bundle.activities[0]).toMatchObject({ id: activity.id, provenance: { sourceRecordId: sourceRecord.id, importBatchId: batch.id } });
    expect(bundle.performanceEvents[0]).toMatchObject({ id: event.id, activityId: activity.id, isRace: true, provenance: { sourceRecordId: sourceRecord.id } });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('secretFormula');
    expect(serialized).not.toContain('not-exported-upload-hash');
    expect(serialized).not.toContain('raw_payload_json');
  });

  it('marks manual canonical records as unsupported rather than inventing provenance', async () => {
    const activityHash = `manual-${randomUUID()}`;
    await db.insertInto('activities').values({
      source: 'manual', source_record_id: null, source_activity_id: null, source_record_hash: activityHash,
      activity_date: metricDate, start_time: null, activity_type: 'workout', subtype: 'manual', distance_m: null,
      duration_s: null, moving_time_s: null, steps: null, calories: null, avg_hr: null, max_hr: null,
      elevation_gain_m: null, avg_speed_mps: null, avg_pace_s_per_km: null, effort_points: 5,
      notes: null, raw_payload_json: {},
    }).execute();

    const bundle = await new CanonicalExportRepository(db).buildBundle(metricDate, metricDate);
    expect(bundle.activities).toHaveLength(1);
    expect(bundle.activities[0]?.provenance).toMatchObject({ status: 'unsupported', sourceRecordId: null, importBatchId: null });
  });
});

async function cleanup(db: TestDatabase, batchIds: string[]): Promise<void> {
  await db.deleteFrom('performance_events').where('event_date', '=', metricDate).execute();
  await db.deleteFrom('score_ledger').where('metric_date', '=', metricDate).execute();
  await db.deleteFrom('daily_metrics').where('metric_date', '=', metricDate).execute();
  await db.deleteFrom('activities').where('activity_date', '=', metricDate).execute();
  if (batchIds.length > 0) {
    await db.deleteFrom('source_records').where('import_batch_id', 'in', batchIds).execute();
    await db.deleteFrom('import_batches').where('id', 'in', batchIds).execute();
    batchIds.splice(0, batchIds.length);
  }
}

function requireTestDatabaseUrl(): string {
  if (!testDatabaseUrl) throw new Error('SPORTOS_TEST_DATABASE_URL is required.');
  return testDatabaseUrl;
}
