import { createHash } from 'node:crypto';
import { aggregateActivitiesToDailyFacts, scoreDay, type ActivityFact } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Activity, DailyMetric, Database, Json } from '../schema.js';
import type { DailyMetricFactsInput, ManualDailyFactsInput } from '../repository-contracts.js';
import { DailyRepository } from './daily.repository.js';
import { ImportsRepository } from './imports.repository.js';
import { ScoringRepository } from './scoring.repository.js';

export class DailyRecalculationUnavailableError extends Error {
  readonly code = 'STRAVA_DATA_UNAVAILABLE' as const;

  constructor(readonly metricDate: string) {
    super(`No Strava activity is available for ${metricDate}.`);
    this.name = 'DailyRecalculationUnavailableError';
  }
}

export class DailyScoringRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async saveManualFacts(metricDate: string, input: ManualDailyFactsInput) {
    return this.db.transaction().execute(async (transaction) => {
      await lockDailyScore(transaction, metricDate);

      const existing = await transaction
        .selectFrom('daily_metrics')
        .selectAll()
        .where('metric_date', '=', metricDate)
        .forUpdate()
        .executeTakeFirst();
      const facts: DailyMetricFactsInput = {
        metricDate,
        ...input,
        excelAllPoints: optionalNumber(existing?.excel_all_points),
        excelRowHash: existing?.excel_row_hash ?? undefined,
      };
      const score = scoreDay(
        { ...facts, excelAllPoints: undefined, excelRowHash: undefined },
        [],
        await new ScoringRepository(transaction).listEnabledRules(),
      );

      const rawJson: Json = { metricDate, facts: { ...input } };
      const rowHash = createHash('sha256').update(JSON.stringify(rawJson)).digest('hex');
      const importsRepository = new ImportsRepository(transaction);
      const batch = await importsRepository.createBatch({
        source: 'manual_daily_edit',
        sourceKind: 'manual',
        metadata: { action: 'daily-facts-edit' },
      });
      const sourceRecord = (await importsRepository.insertSourceRecords([{
        import_batch_id: batch.id,
        source: 'manual_daily_edit',
        sheet_name: null,
        row_index: null,
        source_record_key: `daily:${metricDate}`,
        row_hash: rowHash,
        raw_json: rawJson,
        normalized_entity_type: null,
        normalized_entity_id: null,
        status: 'raw',
        errors: [],
        warnings: [],
      }]))[0];
      if (!sourceRecord) throw new Error(`Manual source record was not created for ${metricDate}.`);

      await transaction.deleteFrom('activities')
        .where('activity_date', '=', metricDate)
        .where('source', '=', 'manual')
        .execute();
      const dailyRepository = new DailyRepository(transaction);
      await dailyRepository.upsertActivities(manualActivities(metricDate, input, sourceRecord.id, rowHash));
      await dailyRepository.persistDailyScore(
        facts,
        score,
        sourceRecord.id,
        { scoreStatus: 'manual', trigger: 'manual_edit' },
      );
      await importsRepository.markRecordsNormalized([{
        sourceRecordId: sourceRecord.id,
        entityType: 'daily_metric',
        entityId: metricDate,
      }]);
      await importsRepository.setAffectedDates(batch.id, [metricDate]);
      await importsRepository.updateBatchCounts(batch.id, {
        row_count: 1,
        normalized_count: 1,
        status: 'scored',
      }, 'manual-daily-facts-saved');

      const result = await dailyRepository.getDailyScoreBreakdown(metricDate);
      if (!result) throw new Error(`Daily score disappeared while saving manual facts for ${metricDate}.`);
      return result;
    });
  }

  async recalculateFromActivities(metricDate: string) {
    return this.db.transaction().execute(async (transaction) => {
      await lockDailyScore(transaction, metricDate);

      const daily = await transaction
        .selectFrom('daily_metrics')
        .selectAll()
        .where('metric_date', '=', metricDate)
        .forUpdate()
        .executeTakeFirst();
      const dailyRepository = new DailyRepository(transaction);
      const activityRows = await dailyRepository.listActivitiesForDates([metricDate]);
      const activities = activityRows.map(toActivityFact).filter((activity) => activity.source !== 'manual');
      const stravaActivities = activities.filter((activity) => activity.source === 'strava');

      if (!daily && stravaActivities.length === 0) {
        throw new DailyRecalculationUnavailableError(metricDate);
      }

      const scoringActivities = daily ? activities : stravaActivities;
      const facts = daily
        ? factsFromDailyRow(daily, scoringActivities)
        : aggregateActivitiesToDailyFacts(metricDate, stravaActivities);
      const score = scoreDay(
        { ...facts, excelAllPoints: undefined, excelRowHash: undefined },
        scoringActivities,
        await new ScoringRepository(transaction).listEnabledRules(),
      );

      await dailyRepository.persistDailyScore(
        facts,
        score,
        daily?.source_record_id ?? undefined,
        { scoreStatus: 'calculated', trigger: 'manual_recalculation' },
      );

      const result = await dailyRepository.getDailyScoreBreakdown(metricDate);
      if (!result) throw new Error(`Daily score disappeared while recalculating ${metricDate}.`);
      return result;
    });
  }
}

async function lockDailyScore(db: Kysely<Database>, metricDate: string): Promise<void> {
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended(
        'sportos.daily.score-write:' || sportos_current_account_id()::text || ':' || ${metricDate},
        0
      )
    )
  `.execute(db);
}

function manualActivities(
  metricDate: string,
  input: ManualDailyFactsInput,
  sourceRecordId: string,
  rowHash: string,
) {
  const rows: Array<{
    activityType: Activity['activity_type'];
    subtype: Activity['subtype'];
    distanceM?: number;
    steps?: number;
    effortPoints?: number;
  }> = [];
  if (input.steps > 0) rows.push({ activityType: 'steps', subtype: 'manual', steps: input.steps });
  appendDistance(rows, 'run', 'treadmill', input.runIndoorM);
  appendDistance(rows, 'run', 'outdoor', input.runOutdoorM);
  appendDistance(rows, 'run', 'unknown', input.runM - input.runIndoorM - input.runOutdoorM);
  appendDistance(rows, 'bike', 'indoor', input.bikeIndoorM);
  appendDistance(rows, 'bike', 'outdoor', input.bikeOutdoorM);
  appendDistance(rows, 'bike', 'unknown', input.bikeM - input.bikeIndoorM - input.bikeOutdoorM);
  appendDistance(rows, 'swim', 'manual', input.swimM);
  if (input.workoutPoints > 0) rows.push({ activityType: 'workout', subtype: 'manual', effortPoints: input.workoutPoints });
  if (input.powerPoints > 0) rows.push({ activityType: 'power_bonus', subtype: 'manual', effortPoints: input.powerPoints });

  return rows.map((row, index) => ({
    source: 'manual' as const,
    source_record_id: sourceRecordId,
    source_activity_id: `${metricDate}:${index + 1}`,
    source_record_hash: `${rowHash}:${index + 1}`,
    activity_date: metricDate,
    start_time: null,
    activity_type: row.activityType,
    subtype: row.subtype,
    distance_m: row.distanceM ?? null,
    duration_s: null,
    moving_time_s: null,
    steps: row.steps ?? null,
    calories: null,
    avg_hr: null,
    max_hr: null,
    elevation_gain_m: null,
    avg_speed_mps: null,
    avg_pace_s_per_km: null,
    effort_points: row.effortPoints ?? null,
    notes: null,
    raw_payload_json: { manualDailyFacts: true },
  }));
}

function appendDistance(
  rows: Array<{ activityType: Activity['activity_type']; subtype: Activity['subtype']; distanceM?: number }>,
  activityType: 'run' | 'bike' | 'swim',
  subtype: NonNullable<Activity['subtype']>,
  distanceM: number,
): void {
  if (distanceM > 0) rows.push({ activityType, subtype, distanceM });
}

function factsFromDailyRow(row: DailyMetric, activities: ActivityFact[]): DailyMetricFactsInput {
  const stored = {
    metricDate: dateString(row.metric_date),
    steps: number(row.steps),
    runM: number(row.run_m),
    bikeM: number(row.bike_m),
    swimM: number(row.swim_m),
    workoutPoints: number(row.workout_points),
    powerPoints: number(row.power_points),
    excelAllPoints: optionalNumber(row.excel_all_points),
    excelRowHash: row.excel_row_hash ?? undefined,
  };

  if (activities.length === 0) return stored;

  const aggregated = aggregateActivitiesToDailyFacts(
    stored.metricDate,
    activities,
    stored.excelAllPoints,
  );
  return {
    ...aggregated,
    excelRowHash: stored.excelRowHash,
  };
}

function toActivityFact(row: Activity): ActivityFact {
  return {
    id: row.id,
    activityDate: dateString(row.activity_date),
    activityType: row.activity_type,
    subtype: row.subtype ?? undefined,
    distanceM: optionalNumber(row.distance_m),
    durationS: optionalNumber(row.duration_s),
    steps: optionalNumber(row.steps),
    avgSpeedMps: optionalNumber(row.avg_speed_mps),
    effortPoints: optionalNumber(row.effort_points),
    source: row.source,
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return number(value);
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Invalid numeric daily score input.');
  return parsed;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new Error('Invalid daily score date.');
}
