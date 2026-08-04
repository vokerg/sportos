import { sql, type Kysely } from 'kysely';
import type {
  DailyMetricFactsInput,
  DailyScoreBreakdownReadModel,
  DailyScoreInput,
  ScoreBreakdownActivityReadModel,
  ScoreBreakdownLedgerEntryReadModel,
  ScoreBreakdownRuleReadModel,
  SourceRecordReferenceReadModel,
} from '../repository-contracts.js';
import type { Activity, ActivitiesTable, Database, ImportBatchesTable, Json, NewActivity } from '../schema.js';

export interface DailyScoreBreakdownHeaderRow {
  date: string;
  recomputedAt: unknown;
  steps: number;
  runM: number;
  bikeM: number;
  swimM: number;
  workoutPoints: number;
  powerPoints: number;
  baseTotal: number;
  bonusTotal: number;
  appTotal: number;
  excelTotal: number | null;
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
}

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

  async listActivitiesForDates(metricDates: string[]): Promise<Activity[]> {
    if (metricDates.length === 0) return [];
    return this.db
      .selectFrom('activities')
      .selectAll()
      .where('activity_date', 'in', metricDates)
      .orderBy('activity_date', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async upsertDailyMetric(facts: DailyMetricFactsInput, score: DailyScoreInput, sourceRecordId?: string): Promise<void> {
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
        power_points: facts.powerPoints,
        base_points: score.basePoints,
        bonus_points: score.bonusPoints,
        total_points: score.totalPoints,
        excel_all_points: facts.excelAllPoints ?? null,
        excel_row_hash: facts.excelRowHash ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['owner_id', 'metric_date']).doUpdateSet({
          source_record_id: sourceRecordId ?? null,
          steps: facts.steps,
          run_m: facts.runM,
          bike_m: facts.bikeM,
          swim_m: facts.swimM,
          workout_points: facts.workoutPoints,
          power_points: facts.powerPoints,
          base_points: score.basePoints,
          bonus_points: score.bonusPoints,
          total_points: score.totalPoints,
          excel_all_points: facts.excelAllPoints ?? null,
          excel_row_hash: facts.excelRowHash ?? null,
          recomputed_at: new Date(),
        }),
      )
      .execute();
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

  async getDailyScoreBreakdown(metricDate: string): Promise<DailyScoreBreakdownReadModel | null> {
    const header = await this.db
      .selectFrom('daily_metrics as dm')
      .leftJoin('source_records as dsr', 'dsr.id', 'dm.source_record_id')
      .leftJoin('import_batches as dib', 'dib.id', 'dsr.import_batch_id')
      .select([
        'dm.metric_date as date',
        'dm.recomputed_at as recomputedAt',
        'dm.steps as steps',
        'dm.run_m as runM',
        'dm.bike_m as bikeM',
        'dm.swim_m as swimM',
        'dm.workout_points as workoutPoints',
        'dm.power_points as powerPoints',
        'dm.base_points as baseTotal',
        'dm.bonus_points as bonusTotal',
        'dm.total_points as appTotal',
        'dm.excel_all_points as excelTotal',
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
      ])
      .where('dm.metric_date', '=', metricDate)
      .executeTakeFirst() as unknown as DailyScoreBreakdownHeaderRow | undefined;

    if (!header) return null;

    const ledgerRows = await this.db
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
      ])
      .where('sl.metric_date', '=', metricDate)
      .orderBy('sr.priority', 'asc')
      .orderBy('sl.created_at', 'asc')
      .orderBy('sl.id', 'asc')
      .execute() as unknown as DailyScoreBreakdownLedgerRow[];

    return assembleDailyScoreBreakdown(header, ledgerRows);
  }
}

export function assembleDailyScoreBreakdown(
  header: DailyScoreBreakdownHeaderRow,
  ledgerRows: DailyScoreBreakdownLedgerRow[],
): DailyScoreBreakdownReadModel {
  const ledger = ledgerRows.map(mapLedgerEntry);
  const ledgerTotal = ledger.reduce((sum, entry) => sum + entry.points, 0);
  return {
    date: header.date,
    recomputedAt: toIsoTimestamp(header.recomputedAt),
    facts: {
      steps: header.steps,
      runM: header.runM,
      bikeM: header.bikeM,
      swimM: header.swimM,
      workoutPoints: header.workoutPoints,
      powerPoints: header.powerPoints,
    },
    score: {
      appTotal: header.appTotal,
      excelTotal: header.excelTotal,
      delta: header.excelTotal === null ? null : header.appTotal - header.excelTotal,
      baseTotal: header.baseTotal,
      bonusTotal: header.bonusTotal,
      ledgerTotal,
    },
    sourceRecord: mapHeaderSourceRecord(header),
    ledger,
  };
}

function mapLedgerEntry(row: DailyScoreBreakdownLedgerRow): ScoreBreakdownLedgerEntryReadModel {
  return {
    id: row.ledgerId,
    points: row.ledgerPoints,
    reason: row.ledgerReason,
    calculation: row.ledgerCalculation,
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
    code: row.ruleCode,
    name: row.ruleName,
    activityType: row.ruleActivityType,
    ruleKind: row.ruleKind,
    metric: row.ruleMetric,
    coefficient: row.ruleCoefficient,
    thresholdOperator: row.ruleThresholdOperator,
    thresholdValue: row.ruleThresholdValue,
    thresholdUnit: row.ruleThresholdUnit,
    configuredPoints: row.ruleConfiguredPoints,
    validFrom: row.ruleValidFrom,
    validTo: row.ruleValidTo,
    priority: row.rulePriority,
    enabled: row.ruleEnabled,
    description: row.ruleDescription,
    createdAt: toIsoTimestamp(row.ruleCreatedAt),
  };
}

function mapActivity(row: DailyScoreBreakdownLedgerRow): ScoreBreakdownActivityReadModel | null {
  if (row.activityId === null || row.activitySource === null || row.activityDate === null || row.activityType === null) {
    return null;
  }
  return {
    id: row.activityId,
    source: row.activitySource,
    sourceActivityId: row.activitySourceActivityId,
    activityDate: row.activityDate,
    startTime: toNullableIsoTimestamp(row.activityStartTime),
    activityType: row.activityType,
    subtype: row.activitySubtype,
    distanceM: row.activityDistanceM,
    durationS: row.activityDurationS,
    movingTimeS: row.activityMovingTimeS,
    steps: row.activitySteps,
    calories: row.activityCalories,
    avgHr: row.activityAvgHr,
    maxHr: row.activityMaxHr,
    elevationGainM: row.activityElevationGainM,
    avgSpeedMps: row.activityAvgSpeedMps,
    avgPaceSPerKm: row.activityAvgPaceSPerKm,
    effortPoints: row.activityEffortPoints,
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

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new TypeError('Expected a database timestamp value.');
}

function toNullableIsoTimestamp(value: unknown | null): string | null {
  return value === null ? null : toIsoTimestamp(value);
}
