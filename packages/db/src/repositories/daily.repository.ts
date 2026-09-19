import { sql, type Kysely } from 'kysely';
import type {
  DailyMetricFactsInput,
  DailyEvidenceReadModel,
  ManualDailyFactsInput,
  ManualDailyFactsRow,
  DailyScoreBreakdownReadModel,
  DailyScoreInput,
  DailyScoreSnapshotTrigger,
  DailyScoreStatus,
  DailyRunStepCalculation,
  DailyStepsCalculation,
  GarminObservationReadModel,
  ScoreBreakdownActivityReadModel,
  ScoreBreakdownLedgerEntryReadModel,
  ScoreBreakdownRuleReadModel,
  SourceRecordReferenceReadModel,
} from '../repository-contracts.js';
import type { Activity, ActivitiesTable, Database, ImportBatchesTable, Json, NewActivity } from '../schema.js';

export interface DailyScoreBreakdownHeaderRow {
  date: string;
  recomputedAt: unknown;
  scoreStatus: DailyScoreStatus;
  steps: number;
  runM: number;
  bikeM: number;
  swimM: number;
  workoutPoints: number;
  baseTotal: number;
  bonusPoints: number;
  appTotal: number;
  excelTotal: number | null;
  snapshotFacts?: Json | null;
  sourceRecordId: string | null;
  sourceRowHash: string | null;
  sourceSheetName: string | null;
  sourceRowIndex: number | null;
  sourceBatchId: string | null;
  sourceBatchSource: string | null;
  sourceBatchFilename: string | null;
  sourceBatchOriginalSha256: string | null;
  sourceBatchStatus: ImportBatchesTable['status'] | null;
  sourceBatchStartedAt: unknown | null;
  sourceBatchCompletedAt: unknown | null;
  sourceStatus?: 'raw' | 'normalized' | 'skipped' | 'error' | null;
  sourceRawJson?: Json | null;
  sourceErrors?: Json | null;
  sourceWarnings?: Json | null;
  sourceNormalizedEntityType?: string | null;
  sourceNormalizedEntityId?: string | null;
}

export type ScoringActivityRow = Activity & { sourceRawJson: Json | null };

export interface DailyScoreBreakdownLedgerRow {
  ledgerId: string;
  ledgerPoints: number;
  ledgerReason: string;
  ledgerCalculation: Json;
  ledgerCreatedAt: unknown;
  ruleId: string | null;
  ruleCode: string | null;
  ruleName: string | null;
  ruleActivityType: ActivitiesTable['activity_type'] | null;
  ruleKind: 'coefficient' | 'achievement' | 'manual_points' | null;
  ruleMetric: string | null;
  ruleCoefficient: number | null;
  ruleThresholdOperator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists' | null;
  ruleThresholdValue: number | null;
  ruleThresholdUnit: string | null;
  ruleConfiguredPoints: number | null;
  ruleAchievementGroup: string | null;
  rulePointsMultiplier: 'completed_5k_blocks' | 'rounded_5k_blocks' | null;
  ruleValidFrom: string | null;
  ruleValidTo: string | null;
  rulePriority: number | null;
  ruleEnabled: boolean | null;
  ruleDescription: string | null;
  ruleCreatedAt: unknown | null;
  activityId: string | null;
  activitySource: ActivitiesTable['source'] | null;
  activitySourceActivityId: string | null;
  activityDate: string | null;
  activityStartTime: unknown | null;
  activityType: ActivitiesTable['activity_type'] | null;
  activitySubtype: ActivitiesTable['subtype'] | null;
  activityDistanceM: number | null;
  activityDurationS: number | null;
  activityMovingTimeS: number | null;
  activitySteps: number | null;
  activityCalories: number | null;
  activityAvgHr: number | null;
  activityMaxHr: number | null;
  activityElevationGainM: number | null;
  activityAvgSpeedMps: number | null;
  activityAvgPaceSPerKm: number | null;
  activityEffortPoints: number | null;
  activityNotes: string | null;
  activitySourceRecordId: string | null;
  activitySourceRowHash: string | null;
  activitySourceSheetName: string | null;
  activitySourceRowIndex: number | null;
  activitySourceBatchId: string | null;
  activitySourceBatchSource: string | null;
  activitySourceBatchFilename: string | null;
  activitySourceBatchOriginalSha256: string | null;
  activitySourceBatchStatus: ImportBatchesTable['status'] | null;
  activitySourceBatchStartedAt: unknown | null;
  activitySourceBatchCompletedAt: unknown | null;
  activitySourceStatus?: 'raw' | 'normalized' | 'skipped' | 'error' | null;
  activitySourceRawJson?: Json | null;
  activitySourceErrors?: Json | null;
  activitySourceWarnings?: Json | null;
  activitySourceNormalizedEntityType?: string | null;
  activitySourceNormalizedEntityId?: string | null;
}

export interface DailyGarminObservationRow {
  observationId: string;
  reportType: GarminObservationReadModel['reportType'];
  recordedDate: string;
  recordedTime: string | null;
  values: Json;
  sourceRecordId: string;
  sourceRowHash: string;
  sourceSheetName: string | null;
  sourceRowIndex: number | null;
  sourceStatus: 'raw' | 'normalized' | 'skipped' | 'error';
  sourceRawJson: Json;
  sourceErrors: Json;
  sourceWarnings: Json;
  sourceNormalizedEntityType: string | null;
  sourceNormalizedEntityId: string | null;
  sourceBatchId: string;
  sourceBatchSource: string;
  sourceBatchFilename: string | null;
  sourceBatchOriginalSha256: string | null;
  sourceBatchStatus: ImportBatchesTable['status'];
  sourceBatchStartedAt: unknown;
  sourceBatchCompletedAt: unknown | null;
}

export interface DailyScorePersistenceOptions {
  scoreStatus: DailyScoreStatus;
  trigger: DailyScoreSnapshotTrigger;
}

export class DailyRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async upsertActivities(rows: NewActivity[]): Promise<Activity[]> {
    if (rows.length === 0) return [];
    const upserted: Activity[] = [];
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      upserted.push(
        ...(await this.db
          .insertInto('activities')
          .values(chunk)
          .onConflict((oc) =>
            oc.columns(['owner_id', 'source', 'source_record_hash']).doUpdateSet({
              source_record_id: sql`excluded.source_record_id`,
              source_activity_id: sql`excluded.source_activity_id`,
              activity_date: sql`excluded.activity_date`,
              start_time: sql`excluded.start_time`,
              activity_type: sql`excluded.activity_type`,
              subtype: sql`excluded.subtype`,
              distance_m: sql`excluded.distance_m`,
              duration_s: sql`excluded.duration_s`,
              moving_time_s: sql`excluded.moving_time_s`,
              steps: sql`excluded.steps`,
              calories: sql`excluded.calories`,
              avg_hr: sql`excluded.avg_hr`,
              max_hr: sql`excluded.max_hr`,
              elevation_gain_m: sql`excluded.elevation_gain_m`,
              avg_speed_mps: sql`excluded.avg_speed_mps`,
              avg_pace_s_per_km: sql`excluded.avg_pace_s_per_km`,
              effort_points: sql`excluded.effort_points`,
              notes: sql`excluded.notes`,
              raw_payload_json: sql`excluded.raw_payload_json`,
              updated_at: new Date(),
            }),
          )
          .returningAll()
          .execute()),
      );
    }
    return upserted;
  }

  async listActivitiesForDates(metricDates: string[]): Promise<ScoringActivityRow[]> {
    if (metricDates.length === 0) return [];
    return this.db
      .selectFrom('activities as activity')
      .leftJoin('source_records as source', 'source.id', 'activity.source_record_id')
      .selectAll('activity')
      .select('source.raw_json as sourceRawJson')
      .where('activity.activity_date', 'in', metricDates)
      .orderBy('activity.activity_date', 'asc')
      .orderBy('activity.id', 'asc')
      .execute() as unknown as Promise<ScoringActivityRow[]>;
  }

  async getGarminDailySteps(metricDate: string): Promise<number | null> {
    const row = await this.db
      .selectFrom('garmin_observations')
      .select('values_json')
      .where('report_type', '=', 'daily_summary')
      .where('recorded_date', '=', metricDate)
      .executeTakeFirst();
    if (!row) return null;
    const steps = jsonRecord(row.values_json).steps;
    if (typeof steps !== 'number' || !Number.isSafeInteger(steps) || steps < 0) {
      throw new Error(`Garmin daily steps are invalid for ${metricDate}.`);
    }
    return steps;
  }

  async upsertDailyMetric(
    facts: DailyMetricFactsInput,
    score: DailyScoreInput,
    sourceRecordId?: string,
    options: DailyScorePersistenceOptions = {
      scoreStatus: facts.excelAllPoints === undefined ? 'calculated' : 'imported',
      trigger: facts.excelAllPoints === undefined ? 'rule_recomputation' : 'workbook_import',
    },
  ): Promise<void> {
    const snapshot = await this.db
      .insertInto('daily_score_snapshots')
      .values({
        metric_date: facts.metricDate,
        score_status: options.scoreStatus,
        base_points: score.basePoints,
        bonus_points: score.bonusPoints,
        total_points: score.totalPoints,
        facts_json: jsonb(jsonValue(facts)),
        ledger_json: jsonb(jsonValue(score.ledger)),
        source_record_id: sourceRecordId ?? null,
        trigger: options.trigger,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('daily_metrics')
      .values({
        metric_date: facts.metricDate,
        source_record_id: sourceRecordId ?? null,
        steps: facts.steps,
        run_m: facts.runM,
        bike_m: facts.bikeM,
        swim_m: facts.swimM,
        workout_points: facts.workoutPoints,
        base_points: score.basePoints,
        bonus_points: score.bonusPoints,
        total_points: score.totalPoints,
        excel_all_points: facts.excelAllPoints ?? null,
        excel_row_hash: facts.excelRowHash ?? null,
        score_status: options.scoreStatus,
        score_snapshot_id: snapshot.id,
      })
      .onConflict((oc) =>
        oc.columns(['owner_id', 'metric_date']).doUpdateSet({
          // An activity-based recalculation has no new workbook row. Keep the
          // existing daily provenance unless this write explicitly supplies a
          // replacement source record.
          source_record_id: sourceRecordId === undefined ? sql`daily_metrics.source_record_id` : sourceRecordId,
          steps: facts.steps,
          run_m: facts.runM,
          bike_m: facts.bikeM,
          swim_m: facts.swimM,
          workout_points: facts.workoutPoints,
          base_points: score.basePoints,
          bonus_points: score.bonusPoints,
          total_points: score.totalPoints,
          excel_all_points: facts.excelAllPoints ?? null,
          excel_row_hash: facts.excelRowHash ?? null,
          score_status: options.scoreStatus,
          score_snapshot_id: snapshot.id,
          recomputed_at: new Date(),
        }),
      )
      .execute();
  }

  async persistDailyScore(
    facts: DailyMetricFactsInput,
    score: DailyScoreInput,
    sourceRecordId: string | undefined,
    options: DailyScorePersistenceOptions,
  ): Promise<void> {
    await this.upsertDailyMetric(facts, score, sourceRecordId, options);
    await this.replaceScoreLedger(facts.metricDate, score.ledger);
  }

  async replaceScoreLedger(metricDate: string, entries: DailyScoreInput['ledger']): Promise<void> {
    await this.db.deleteFrom('score_ledger').where('metric_date', '=', metricDate).execute();
    if (entries.length === 0) return;
    await this.db
      .insertInto('score_ledger')
      .values(entries.map((entry) => ({
        metric_date: entry.metricDate,
        activity_id: entry.activityId ?? null,
        rule_id: entry.ruleId ?? null,
        points: entry.points,
        reason: entry.reason,
        calculation_json: entry.calculationJson as Json,
      })))
      .execute();
  }

  async listDailySummary(limit = 90) {
    return this.db
      .selectFrom('v_daily_summary')
      .selectAll()
      .where('metric_date', '<=', new Date().toISOString().slice(0, 10))
      .orderBy('metric_date', 'desc')
      .limit(limit)
      .execute();
  }

  async listManualDailyFacts(input: { from?: string; to?: string; limit?: number } = {}): Promise<ManualDailyFactsRow[]> {
    let query = this.db
      .selectFrom('daily_metrics as dm')
      .leftJoin('daily_score_snapshots as dss', 'dss.id', 'dm.score_snapshot_id')
      .select([
        'dm.metric_date as date',
        'dm.score_status as scoreStatus',
        'dm.total_points as totalPoints',
        'dm.steps as steps',
        'dm.run_m as runM',
        'dm.bike_m as bikeM',
        'dm.swim_m as swimM',
        'dm.workout_points as workoutPoints',
        'dm.bonus_points as bonusPoints',
        'dss.facts_json as snapshotFacts',
      ])
      .where('dm.metric_date', '<=', input.to ?? new Date().toISOString().slice(0, 10));
    if (input.from !== undefined) query = query.where('dm.metric_date', '>=', input.from);
    const rows = await query
      .orderBy('dm.metric_date', 'desc')
      .limit(input.limit ?? 365)
      .execute();

    return rows.map((row) => {
      const snapshot = jsonRecord(row.snapshotFacts);
      const runIndoorM = finiteSnapshotNumber(snapshot.runIndoorM);
      const runOutdoorM = finiteSnapshotNumber(snapshot.runOutdoorM);
      const bikeIndoorM = finiteSnapshotNumber(snapshot.bikeIndoorM);
      const bikeOutdoorM = finiteSnapshotNumber(snapshot.bikeOutdoorM);
      return {
        date: toIsoDate(row.date),
        scoreStatus: row.scoreStatus,
        totalPoints: databaseNumber(row.totalPoints, 'daily total points'),
        facts: {
          steps: databaseNumber(row.steps, 'daily steps'),
          runIndoorM,
          runOutdoorM,
          runUnspecifiedM: finiteSnapshotNumber(snapshot.runUnspecifiedM, Math.max(databaseNumber(row.runM, 'daily run distance') - runIndoorM - runOutdoorM, 0)),
          bikeIndoorM,
          bikeOutdoorM,
          bikeUnspecifiedM: finiteSnapshotNumber(snapshot.bikeUnspecifiedM, Math.max(databaseNumber(row.bikeM, 'daily bike distance') - bikeIndoorM - bikeOutdoorM, 0)),
          swimM: databaseNumber(row.swimM, 'daily swim distance'),
          workoutPoints: databaseNumber(row.workoutPoints, 'daily workout points'),
          bonusPoints: databaseNumber(row.bonusPoints, 'daily bonus points'),
        },
      };
    });
  }

  async getDailyScoreBreakdown(metricDate: string): Promise<DailyScoreBreakdownReadModel | null> {
    const header = await this.db
      .selectFrom('daily_metrics as dm')
      .leftJoin('daily_score_snapshots as dss', 'dss.id', 'dm.score_snapshot_id')
      .leftJoin('source_records as dsr', 'dsr.id', 'dm.source_record_id')
      .leftJoin('import_batches as dib', 'dib.id', 'dsr.import_batch_id')
      .select([
        'dm.metric_date as date',
        'dm.recomputed_at as recomputedAt',
        'dm.score_status as scoreStatus',
        'dm.steps as steps',
        'dm.run_m as runM',
        'dm.bike_m as bikeM',
        'dm.swim_m as swimM',
        'dm.workout_points as workoutPoints',
        'dm.base_points as baseTotal',
        'dm.bonus_points as bonusPoints',
        'dm.total_points as appTotal',
        'dm.excel_all_points as excelTotal',
        'dss.facts_json as snapshotFacts',
        'dsr.id as sourceRecordId',
        'dsr.row_hash as sourceRowHash',
        'dsr.sheet_name as sourceSheetName',
        'dsr.row_index as sourceRowIndex',
        'dib.id as sourceBatchId',
        'dib.source as sourceBatchSource',
        'dib.filename as sourceBatchFilename',
        'dib.original_sha256 as sourceBatchOriginalSha256',
        'dib.status as sourceBatchStatus',
        'dib.started_at as sourceBatchStartedAt',
        'dib.completed_at as sourceBatchCompletedAt',
        'dsr.status as sourceStatus',
        'dsr.raw_json as sourceRawJson',
        'dsr.errors as sourceErrors',
        'dsr.warnings as sourceWarnings',
        'dsr.normalized_entity_type as sourceNormalizedEntityType',
        'dsr.normalized_entity_id as sourceNormalizedEntityId',
      ])
      .where('dm.metric_date', '=', metricDate)
      .executeTakeFirst() as unknown as DailyScoreBreakdownHeaderRow | undefined;

    if (!header) return null;

    const ledgerRowsPromise = this.db
      .selectFrom('score_ledger as sl')
      .leftJoin('scoring_rules as sr', 'sr.id', 'sl.rule_id')
      .leftJoin('activities as a', 'a.id', 'sl.activity_id')
      .leftJoin('source_records as asr', 'asr.id', 'a.source_record_id')
      .leftJoin('import_batches as aib', 'aib.id', 'asr.import_batch_id')
      .select([
        'sl.id as ledgerId',
        'sl.points as ledgerPoints',
        'sl.reason as ledgerReason',
        'sl.calculation_json as ledgerCalculation',
        'sl.created_at as ledgerCreatedAt',
        'sr.id as ruleId',
        'sr.code as ruleCode',
        'sr.name as ruleName',
        'sr.activity_type as ruleActivityType',
        'sr.rule_kind as ruleKind',
        'sr.metric as ruleMetric',
        'sr.coefficient as ruleCoefficient',
        'sr.threshold_operator as ruleThresholdOperator',
        'sr.threshold_value as ruleThresholdValue',
        'sr.threshold_unit as ruleThresholdUnit',
        'sr.points as ruleConfiguredPoints',
        'sr.achievement_group as ruleAchievementGroup',
        'sr.points_multiplier as rulePointsMultiplier',
        'sr.valid_from as ruleValidFrom',
        'sr.valid_to as ruleValidTo',
        'sr.priority as rulePriority',
        'sr.enabled as ruleEnabled',
        'sr.description as ruleDescription',
        'sr.created_at as ruleCreatedAt',
        'a.id as activityId',
        'a.source as activitySource',
        'a.source_activity_id as activitySourceActivityId',
        'a.activity_date as activityDate',
        'a.start_time as activityStartTime',
        'a.activity_type as activityType',
        'a.subtype as activitySubtype',
        'a.distance_m as activityDistanceM',
        'a.duration_s as activityDurationS',
        'a.moving_time_s as activityMovingTimeS',
        'a.steps as activitySteps',
        'a.calories as activityCalories',
        'a.avg_hr as activityAvgHr',
        'a.max_hr as activityMaxHr',
        'a.elevation_gain_m as activityElevationGainM',
        'a.avg_speed_mps as activityAvgSpeedMps',
        'a.avg_pace_s_per_km as activityAvgPaceSPerKm',
        'a.effort_points as activityEffortPoints',
        'a.notes as activityNotes',
        'asr.id as activitySourceRecordId',
        'asr.row_hash as activitySourceRowHash',
        'asr.sheet_name as activitySourceSheetName',
        'asr.row_index as activitySourceRowIndex',
        'aib.id as activitySourceBatchId',
        'aib.source as activitySourceBatchSource',
        'aib.filename as activitySourceBatchFilename',
        'aib.original_sha256 as activitySourceBatchOriginalSha256',
        'aib.status as activitySourceBatchStatus',
        'aib.started_at as activitySourceBatchStartedAt',
        'aib.completed_at as activitySourceBatchCompletedAt',
        'asr.status as activitySourceStatus',
        'asr.raw_json as activitySourceRawJson',
        'asr.errors as activitySourceErrors',
        'asr.warnings as activitySourceWarnings',
        'asr.normalized_entity_type as activitySourceNormalizedEntityType',
        'asr.normalized_entity_id as activitySourceNormalizedEntityId',
      ])
      .where('sl.metric_date', '=', metricDate)
      .orderBy('sr.priority', 'asc')
      .orderBy('sl.created_at', 'asc')
      .orderBy('sl.id', 'asc')
      .execute() as unknown as Promise<DailyScoreBreakdownLedgerRow[]>;

    const activityRowsPromise = this.db
      .selectFrom('activities as a')
      .leftJoin('source_records as asr', 'asr.id', 'a.source_record_id')
      .leftJoin('import_batches as aib', 'aib.id', 'asr.import_batch_id')
      .select([
        'a.id as activityId',
        'a.source as activitySource',
        'a.source_activity_id as activitySourceActivityId',
        'a.activity_date as activityDate',
        'a.start_time as activityStartTime',
        'a.activity_type as activityType',
        'a.subtype as activitySubtype',
        'a.distance_m as activityDistanceM',
        'a.duration_s as activityDurationS',
        'a.moving_time_s as activityMovingTimeS',
        'a.steps as activitySteps',
        'a.calories as activityCalories',
        'a.avg_hr as activityAvgHr',
        'a.max_hr as activityMaxHr',
        'a.elevation_gain_m as activityElevationGainM',
        'a.avg_speed_mps as activityAvgSpeedMps',
        'a.avg_pace_s_per_km as activityAvgPaceSPerKm',
        'a.effort_points as activityEffortPoints',
        'a.notes as activityNotes',
        'asr.id as activitySourceRecordId',
        'asr.row_hash as activitySourceRowHash',
        'asr.sheet_name as activitySourceSheetName',
        'asr.row_index as activitySourceRowIndex',
        'aib.id as activitySourceBatchId',
        'aib.source as activitySourceBatchSource',
        'aib.filename as activitySourceBatchFilename',
        'aib.original_sha256 as activitySourceBatchOriginalSha256',
        'aib.status as activitySourceBatchStatus',
        'aib.started_at as activitySourceBatchStartedAt',
        'aib.completed_at as activitySourceBatchCompletedAt',
        'asr.status as activitySourceStatus',
        'asr.raw_json as activitySourceRawJson',
        'asr.errors as activitySourceErrors',
        'asr.warnings as activitySourceWarnings',
        'asr.normalized_entity_type as activitySourceNormalizedEntityType',
        'asr.normalized_entity_id as activitySourceNormalizedEntityId',
      ])
      .where('a.activity_date', '=', metricDate)
      .orderBy('a.source', 'asc')
      .orderBy('a.activity_type', 'asc')
      .orderBy('a.id', 'asc')
      .execute() as unknown as Promise<DailyScoreBreakdownLedgerRow[]>;

    const [ledgerRows, activityRows, garminRows] = await Promise.all([
      ledgerRowsPromise,
      activityRowsPromise,
      this.listGarminObservationRows(metricDate),
    ]);

    return assembleDailyScoreBreakdown(header, ledgerRows, activityRows, garminRows);
  }

  async getDailyEvidence(metricDate: string): Promise<DailyEvidenceReadModel> {
    return assembleDailyEvidence(metricDate, await this.listGarminObservationRows(metricDate));
  }

  private async listGarminObservationRows(metricDate: string): Promise<DailyGarminObservationRow[]> {
    const rows = await this.db
      .selectFrom('garmin_observations as observation')
      .innerJoin('source_records as source', 'source.id', 'observation.current_source_record_id')
      .innerJoin('import_batches as batch', 'batch.id', 'source.import_batch_id')
      .select([
        'observation.id as observationId',
        'observation.report_type as reportType',
        'observation.recorded_date as recordedDate',
        'observation.recorded_time as recordedTime',
        'observation.values_json as values',
        'source.id as sourceRecordId',
        'source.row_hash as sourceRowHash',
        'source.sheet_name as sourceSheetName',
        'source.row_index as sourceRowIndex',
        'source.status as sourceStatus',
        'source.raw_json as sourceRawJson',
        'source.errors as sourceErrors',
        'source.warnings as sourceWarnings',
        'source.normalized_entity_type as sourceNormalizedEntityType',
        'source.normalized_entity_id as sourceNormalizedEntityId',
        'batch.id as sourceBatchId',
        'batch.source as sourceBatchSource',
        'batch.filename as sourceBatchFilename',
        'batch.original_sha256 as sourceBatchOriginalSha256',
        'batch.status as sourceBatchStatus',
        'batch.started_at as sourceBatchStartedAt',
        'batch.completed_at as sourceBatchCompletedAt',
      ])
      .where('observation.recorded_date', '=', metricDate)
      .orderBy('observation.report_type', 'asc')
      .orderBy('observation.recorded_time', 'asc')
      .orderBy('observation.id', 'asc')
      .execute();
    return rows as unknown as DailyGarminObservationRow[];
  }
}

export function assembleDailyScoreBreakdown(
  header: DailyScoreBreakdownHeaderRow,
  ledgerRows: DailyScoreBreakdownLedgerRow[],
  activityRows: DailyScoreBreakdownLedgerRow[] = [],
  garminRows: DailyGarminObservationRow[] = [],
): DailyScoreBreakdownReadModel {
  const ledger = ledgerRows.map(mapLedgerEntry);
  const activities = activityRows.map(mapActivity).filter((activity): activity is NonNullable<typeof activity> => activity !== null);
  const scoringActivities = header.scoreStatus === 'imported'
    ? activities.filter((activity) => activity.source === 'my_sport_xlsx')
    : header.scoreStatus === 'manual'
      ? activities.filter((activity) => activity.source === 'manual')
      : calculatedDistanceActivities(activities, ledger);
  const subtypeFacts = scoringActivities.reduce(
    (facts, activity) => {
      const distanceM = Number(activity.distanceM ?? 0);
      if (activity.activityType === 'run' && activity.subtype === 'treadmill') facts.runIndoorM += distanceM;
      if (activity.activityType === 'run' && activity.subtype === 'outdoor') facts.runOutdoorM += distanceM;
      if (activity.activityType === 'run' && activity.subtype === 'unknown') facts.runUnspecifiedM += distanceM;
      if (activity.activityType === 'bike' && activity.subtype === 'indoor') facts.bikeIndoorM += distanceM;
      if (activity.activityType === 'bike' && activity.subtype === 'outdoor') facts.bikeOutdoorM += distanceM;
      if (activity.activityType === 'bike' && activity.subtype === 'unknown') facts.bikeUnspecifiedM += distanceM;
      return facts;
    },
    { runIndoorM: 0, runOutdoorM: 0, runUnspecifiedM: 0, bikeIndoorM: 0, bikeOutdoorM: 0, bikeUnspecifiedM: 0 },
  );
  const sourceRecords = dedupeSourceRecords([
    mapHeaderSourceRecord(header),
    ...activities.map((activity) => activity.sourceRecord),
    ...garminRows.map((row) => mapGarminSourceRecord(row)),
  ]);
  const ledgerTotal = ledger.reduce((sum, entry) => sum + entry.points, 0);
  const stepsCalculation = stepsCalculationFromSnapshot(header.snapshotFacts);
  return {
    date: toIsoDate(header.date),
    recomputedAt: toIsoTimestamp(header.recomputedAt),
    scoreStatus: header.scoreStatus,
    facts: {
      steps: databaseNumber(header.steps, 'daily steps'),
      ...(stepsCalculation ? { stepsCalculation } : {}),
      runM: databaseNumber(header.runM, 'daily run distance'),
      bikeM: databaseNumber(header.bikeM, 'daily bike distance'),
      swimM: databaseNumber(header.swimM, 'daily swim distance'),
      ...subtypeFacts,
      workoutPoints: databaseNumber(header.workoutPoints, 'daily workout points'),
    },
    score: {
      appTotal: databaseNumber(header.appTotal, 'daily app total'),
      excelTotal: nullableDatabaseNumber(header.excelTotal, 'daily Excel total'),
      delta: header.excelTotal === null
        ? null
        : databaseNumber(header.appTotal, 'daily app total') - databaseNumber(header.excelTotal, 'daily Excel total'),
      baseTotal: databaseNumber(header.baseTotal, 'daily base total'),
      bonusPoints: databaseNumber(header.bonusPoints, 'daily bonus points'),
      ledgerTotal,
    },
    sourceRecord: mapHeaderSourceRecord(header),
    activities,
    garminObservations: garminRows.map(mapGarminObservation),
    sourceRecords,
    ledger,
  };
}

export function assembleDailyEvidence(
  metricDate: string,
  garminRows: DailyGarminObservationRow[],
): DailyEvidenceReadModel {
  return {
    date: toIsoDate(metricDate),
    garminObservations: garminRows.map(mapGarminObservation),
    sourceRecords: dedupeSourceRecords(garminRows.map(mapGarminSourceRecord)),
  };
}

function calculatedDistanceActivities(
  activities: ScoreBreakdownActivityReadModel[],
  ledger: ScoreBreakdownLedgerEntryReadModel[],
): ScoreBreakdownActivityReadModel[] {
  const linkedActivityIds = new Set(
    ledger
      .map((entry) => entry.activity?.id)
      .filter((id): id is string => id !== undefined),
  );

  return activities.filter((activity) => {
    if (activity.activityType !== 'run' && activity.activityType !== 'bike') return true;

    const linkedForType = activities.some(
      (candidate) => candidate.activityType === activity.activityType && linkedActivityIds.has(candidate.id),
    );
    if (linkedForType) return linkedActivityIds.has(activity.id);

    const hasSourceForType = activities.some(
      (candidate) => candidate.activityType === activity.activityType && candidate.source !== 'manual',
    );
    return hasSourceForType ? activity.source !== 'manual' : activity.source === 'manual';
  });
}

function mapLedgerEntry(row: DailyScoreBreakdownLedgerRow): ScoreBreakdownLedgerEntryReadModel {
  const legacyManualBonus = row.ruleCode === 'power.manual';
  return {
    id: row.ledgerId,
    points: databaseNumber(row.ledgerPoints, 'ledger points'),
    reason: legacyManualBonus
      ? row.ledgerReason.replace(/^Power\/extra-effort points/, 'Manual bonus points')
      : row.ledgerReason,
    calculation: legacyManualBonus ? normalizeLegacyBonusJson(row.ledgerCalculation) : row.ledgerCalculation,
    createdAt: toIsoTimestamp(row.ledgerCreatedAt),
    rule: mapRule(row),
    activity: mapActivity(row),
  };
}

function mapRule(row: DailyScoreBreakdownLedgerRow): ScoreBreakdownRuleReadModel | null {
  if (
    row.ruleId === null ||
    row.ruleCode === null ||
    row.ruleName === null ||
    row.ruleActivityType === null ||
    row.ruleKind === null ||
    row.ruleMetric === null ||
    row.ruleValidFrom === null ||
    row.rulePriority === null ||
    row.ruleEnabled === null ||
    row.ruleCreatedAt === null
  ) {
    return null;
  }
  return {
    id: row.ruleId,
    code: row.ruleCode === 'power.manual' ? 'bonus.manual' : row.ruleCode,
    name: row.ruleCode === 'power.manual' ? 'Manual bonus points' : row.ruleName,
    activityType: row.ruleActivityType,
    ruleKind: row.ruleKind,
    metric: row.ruleMetric,
    coefficient: nullableDatabaseNumber(row.ruleCoefficient, 'rule coefficient'),
    thresholdOperator: row.ruleThresholdOperator,
    thresholdValue: nullableDatabaseNumber(row.ruleThresholdValue, 'rule threshold value'),
    thresholdUnit: row.ruleThresholdUnit,
    configuredPoints: nullableDatabaseNumber(row.ruleConfiguredPoints, 'rule configured points'),
    achievementGroup: row.ruleAchievementGroup,
    pointsMultiplier: row.rulePointsMultiplier,
    validFrom: toIsoDate(row.ruleValidFrom),
    validTo: row.ruleValidTo === null ? null : toIsoDate(row.ruleValidTo),
    priority: row.rulePriority,
    enabled: row.ruleEnabled,
    description: row.ruleDescription,
    createdAt: toIsoTimestamp(row.ruleCreatedAt),
  };
}

function normalizeLegacyBonusJson(value: Json): Json {
  if (value === 'power_bonus') return 'bonus';
  if (Array.isArray(value)) return value.map(normalizeLegacyBonusJson);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key === 'powerPoints' ? 'bonusPoints' : key,
      normalizeLegacyBonusJson(item),
    ]),
  );
}

function mapActivity(row: DailyScoreBreakdownLedgerRow): ScoreBreakdownActivityReadModel | null {
  if (row.activityId === null || row.activitySource === null || row.activityDate === null || row.activityType === null) {
    return null;
  }
  return {
    id: row.activityId,
    source: row.activitySource,
    sourceActivityId: row.activitySourceActivityId,
    activityDate: toIsoDate(row.activityDate),
    startTime: toNullableIsoTimestamp(row.activityStartTime),
    activityType: row.activityType,
    subtype: row.activitySubtype,
    distanceM: nullableDatabaseNumber(row.activityDistanceM, 'activity distance'),
    durationS: nullableDatabaseNumber(row.activityDurationS, 'activity duration'),
    movingTimeS: nullableDatabaseNumber(row.activityMovingTimeS, 'activity moving time'),
    steps: nullableDatabaseNumber(row.activitySteps, 'activity steps'),
    calories: nullableDatabaseNumber(row.activityCalories, 'activity calories'),
    avgHr: nullableDatabaseNumber(row.activityAvgHr, 'activity average heart rate'),
    maxHr: nullableDatabaseNumber(row.activityMaxHr, 'activity maximum heart rate'),
    elevationGainM: nullableDatabaseNumber(row.activityElevationGainM, 'activity elevation gain'),
    avgSpeedMps: nullableDatabaseNumber(row.activityAvgSpeedMps, 'activity average speed'),
    avgPaceSPerKm: nullableDatabaseNumber(row.activityAvgPaceSPerKm, 'activity average pace'),
    effortPoints: nullableDatabaseNumber(row.activityEffortPoints, 'activity effort points'),
    notes: row.activityNotes,
    sourceRecord: mapActivitySourceRecord(row),
  };
}

function mapHeaderSourceRecord(row: DailyScoreBreakdownHeaderRow): SourceRecordReferenceReadModel | null {
  if (
    row.sourceRecordId === null ||
    row.sourceRowHash === null ||
    row.sourceBatchId === null ||
    row.sourceBatchSource === null ||
    row.sourceBatchStatus === null ||
    row.sourceBatchStartedAt === null
  ) {
    return null;
  }
  return {
    id: row.sourceRecordId,
    rowHash: row.sourceRowHash,
    sheetName: row.sourceSheetName,
    rowIndex: row.sourceRowIndex,
    status: row.sourceStatus ?? 'raw',
    rawJson: row.sourceRawJson ?? null,
    errors: row.sourceErrors ?? [],
    warnings: row.sourceWarnings ?? [],
    normalizedEntityType: row.sourceNormalizedEntityType ?? null,
    normalizedEntityId: row.sourceNormalizedEntityId ?? null,
    batch: {
      id: row.sourceBatchId,
      source: row.sourceBatchSource,
      filename: row.sourceBatchFilename,
      originalSha256: row.sourceBatchOriginalSha256,
      status: row.sourceBatchStatus,
      startedAt: toIsoTimestamp(row.sourceBatchStartedAt),
      completedAt: toNullableIsoTimestamp(row.sourceBatchCompletedAt),
    },
  };
}

function mapActivitySourceRecord(row: DailyScoreBreakdownLedgerRow): SourceRecordReferenceReadModel | null {
  if (
    row.activitySourceRecordId === null ||
    row.activitySourceRowHash === null ||
    row.activitySourceBatchId === null ||
    row.activitySourceBatchSource === null ||
    row.activitySourceBatchStatus === null ||
    row.activitySourceBatchStartedAt === null
  ) {
    return null;
  }
  return {
    id: row.activitySourceRecordId,
    rowHash: row.activitySourceRowHash,
    sheetName: row.activitySourceSheetName,
    rowIndex: row.activitySourceRowIndex,
    status: row.activitySourceStatus ?? 'raw',
    rawJson: row.activitySourceRawJson ?? null,
    errors: row.activitySourceErrors ?? [],
    warnings: row.activitySourceWarnings ?? [],
    normalizedEntityType: row.activitySourceNormalizedEntityType ?? null,
    normalizedEntityId: row.activitySourceNormalizedEntityId ?? null,
    batch: {
      id: row.activitySourceBatchId,
      source: row.activitySourceBatchSource,
      filename: row.activitySourceBatchFilename,
      originalSha256: row.activitySourceBatchOriginalSha256,
      status: row.activitySourceBatchStatus,
      startedAt: toIsoTimestamp(row.activitySourceBatchStartedAt),
      completedAt: toNullableIsoTimestamp(row.activitySourceBatchCompletedAt),
    },
  };
}

function mapGarminObservation(row: DailyGarminObservationRow): GarminObservationReadModel {
  return {
    id: row.observationId,
    reportType: row.reportType,
    recordedDate: toIsoDate(row.recordedDate),
    recordedTime: row.recordedTime,
    values: row.values,
    sourceRecord: mapGarminSourceRecord(row),
  };
}

function mapGarminSourceRecord(row: DailyGarminObservationRow): SourceRecordReferenceReadModel {
  return {
    id: row.sourceRecordId,
    rowHash: row.sourceRowHash,
    sheetName: row.sourceSheetName,
    rowIndex: row.sourceRowIndex,
    status: row.sourceStatus,
    rawJson: row.sourceRawJson,
    errors: row.sourceErrors,
    warnings: row.sourceWarnings,
    normalizedEntityType: row.sourceNormalizedEntityType,
    normalizedEntityId: row.sourceNormalizedEntityId,
    batch: {
      id: row.sourceBatchId,
      source: row.sourceBatchSource,
      filename: row.sourceBatchFilename,
      originalSha256: row.sourceBatchOriginalSha256,
      status: row.sourceBatchStatus,
      startedAt: toIsoTimestamp(row.sourceBatchStartedAt),
      completedAt: toNullableIsoTimestamp(row.sourceBatchCompletedAt),
    },
  };
}

function dedupeSourceRecords(records: Array<SourceRecordReferenceReadModel | null>): SourceRecordReferenceReadModel[] {
  const byId = new Map<string, SourceRecordReferenceReadModel>();
  for (const record of records) {
    if (record) byId.set(record.id, record);
  }
  return [...byId.values()];
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new TypeError('Expected a database timestamp value.');
}

function toNullableIsoTimestamp(value: unknown | null): string | null {
  return value === null ? null : toIsoTimestamp(value);
}

function databaseNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`Expected a finite numeric value for ${field}.`);
  return parsed;
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new TypeError('Expected a database date value.');
}

function jsonRecord(value: Json | null): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteSnapshotNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function stepsCalculationFromSnapshot(value: Json | null | undefined): DailyStepsCalculation | null {
  const candidate = jsonRecord(jsonRecord(value ?? null).stepsCalculation as Json | null);
  const sources: DailyStepsCalculation['source'][] = ['manual', 'manual_adjusted', 'imported', 'garmin_adjusted', 'stored', 'none'];
  if (!sources.includes(candidate.source as DailyStepsCalculation['source'])) return null;
  if (typeof candidate.resolvedSteps !== 'number' || !Number.isSafeInteger(candidate.resolvedSteps) || candidate.resolvedSteps < 0) return null;

  const runs = Array.isArray(candidate.runs)
    ? candidate.runs.flatMap((value) => {
      const run = jsonRecord(value as Json);
      if (
        typeof run.movingTimeS !== 'number' || !Number.isFinite(run.movingTimeS) || run.movingTimeS <= 0 ||
        typeof run.cadenceSpm !== 'number' || !Number.isFinite(run.cadenceSpm) || run.cadenceSpm <= 0 ||
        (run.cadenceSource !== 'strava_cadence' && run.cadenceSource !== 'pace_fallback') ||
        typeof run.estimatedSteps !== 'number' || !Number.isSafeInteger(run.estimatedSteps) || run.estimatedSteps < 0
      ) return [];
      return [{
        ...(typeof run.activityId === 'string' ? { activityId: run.activityId } : {}),
        ...(typeof run.distanceM === 'number' && Number.isFinite(run.distanceM) ? { distanceM: run.distanceM } : {}),
        movingTimeS: run.movingTimeS,
        ...(typeof run.paceSPerKm === 'number' && Number.isFinite(run.paceSPerKm) ? { paceSPerKm: run.paceSPerKm } : {}),
        cadenceSpm: run.cadenceSpm,
        cadenceSource: run.cadenceSource as DailyRunStepCalculation['cadenceSource'],
        estimatedSteps: run.estimatedSteps,
      }];
    })
    : undefined;

  return {
    source: candidate.source as DailyStepsCalculation['source'],
    resolvedSteps: candidate.resolvedSteps,
    ...(typeof candidate.totalSteps === 'number' ? { totalSteps: finiteSnapshotNumber(candidate.totalSteps) } : {}),
    ...(typeof candidate.garminTotalSteps === 'number' ? { garminTotalSteps: finiteSnapshotNumber(candidate.garminTotalSteps) } : {}),
    ...(typeof candidate.estimatedRunningSteps === 'number' ? { estimatedRunningSteps: finiteSnapshotNumber(candidate.estimatedRunningSteps) } : {}),
    ...(runs ? { runs } : {}),
    ...(typeof candidate.unestimatedRunCount === 'number' ? { unestimatedRunCount: finiteSnapshotNumber(candidate.unestimatedRunCount) } : {}),
  };
}

function nullableDatabaseNumber(value: unknown | null, field: string): number | null {
  return value === null ? null : databaseNumber(value, field);
}

function jsonb(value: Json) {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}

function jsonValue(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as Json;
}
