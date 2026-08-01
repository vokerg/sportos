import {
  CANONICAL_EXPORT_SCHEMA_VERSION,
  CanonicalExportBundleSchema,
  type CanonicalActivityExportRow,
  type CanonicalDailyExportRow,
  type CanonicalExportBundle,
  type CanonicalPerformanceExportRow,
  type ExportProvenance,
} from '@sportos/shared';
import type { Kysely } from 'kysely';
import type { ActivitiesTable, Database, PerformanceEventsTable } from '../schema.js';

interface ProvenanceColumns {
  sourceRecordId: string | null;
  sourceRecordHash: string | null;
  importBatchId: string | null;
  sourceRecordSource: string | null;
  importBatchSource: string | null;
  sheetName: string | null;
  rowIndex: number | null;
  filename: string | null;
}

interface DailyExportDbRow extends ProvenanceColumns {
  metricDate: unknown;
  steps: number;
  runM: number;
  bikeM: number;
  swimM: number;
  workoutPoints: number;
  powerPoints: number;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  excelAllPoints: number | null;
  pointsDeltaVsExcel: number | null;
  avg10d: number | null;
  avg20d: number | null;
  avg30d: number | null;
  avg60d: number | null;
  avg365d: number | null;
  recomputedAt: unknown;
}

interface ActivityExportDbRow extends ProvenanceColumns {
  id: string;
  activityDate: unknown;
  startTime: unknown | null;
  activityType: ActivitiesTable['activity_type'];
  subtype: ActivitiesTable['subtype'];
  source: ActivitiesTable['source'];
  sourceActivityId: string | null;
  distanceM: number | null;
  durationS: number | null;
  movingTimeS: number | null;
  steps: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  avgSpeedMps: number | null;
  avgPaceSPerKm: number | null;
  effortPoints: number | null;
  notes: string | null;
}

interface PerformanceExportDbRow extends ProvenanceColumns {
  id: string;
  activityId: string | null;
  eventDate: unknown;
  source: PerformanceEventsTable['source'];
  distanceM: number;
  durationS: number;
  paceSPerKm: number;
  isTreadmill: boolean;
  isRace: boolean;
  isPrMarker: boolean;
  sourceRank: number | null;
  tags: string[];
  notes: string | null;
}

export class CanonicalExportRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async buildBundle(from: string, to: string, generatedAt = new Date()): Promise<CanonicalExportBundle> {
    return this.db.transaction().setIsolationLevel('repeatable read').execute(async (transaction) => {
      const reader = new CanonicalExportRepository(transaction);
      const dailyRows = await reader.listDailyRows(from, to);
      const activityRows = await reader.listActivityRows(from, to);
      const performanceRows = await reader.listPerformanceRows(from, to);
      const dailySummaries = dailyRows.map(mapDailyRow);
      const activities = activityRows.map(mapActivityRow);
      const performanceEvents = performanceRows.map(mapPerformanceRow);
      return CanonicalExportBundleSchema.parse({
        schemaVersion: CANONICAL_EXPORT_SCHEMA_VERSION,
        generatedAt: generatedAt.toISOString(),
        dateRange: { from, to },
        rowCounts: {
          dailySummaries: dailySummaries.length,
          activities: activities.length,
          performanceEvents: performanceEvents.length,
        },
        dailySummaries,
        activities,
        performanceEvents,
      });
    });
  }

  private async listDailyRows(from: string, to: string): Promise<DailyExportDbRow[]> {
    return this.db
      .selectFrom('v_daily_summary as summary')
      .innerJoin('daily_metrics as daily', 'daily.metric_date', 'summary.metric_date')
      .leftJoin('source_records as source_record', 'source_record.id', 'daily.source_record_id')
      .leftJoin('import_batches as import_batch', 'import_batch.id', 'source_record.import_batch_id')
      .select([
        'summary.metric_date as metricDate',
        'summary.steps as steps',
        'summary.run_m as runM',
        'summary.bike_m as bikeM',
        'summary.swim_m as swimM',
        'summary.workout_points as workoutPoints',
        'summary.power_points as powerPoints',
        'summary.base_points as basePoints',
        'summary.bonus_points as bonusPoints',
        'summary.total_points as totalPoints',
        'summary.excel_all_points as excelAllPoints',
        'summary.points_delta_vs_excel as pointsDeltaVsExcel',
        'summary.avg_10d as avg10d',
        'summary.avg_20d as avg20d',
        'summary.avg_30d as avg30d',
        'summary.avg_60d as avg60d',
        'summary.avg_365d as avg365d',
        'daily.recomputed_at as recomputedAt',
        'source_record.id as sourceRecordId',
        'source_record.row_hash as sourceRecordHash',
        'source_record.source as sourceRecordSource',
        'source_record.sheet_name as sheetName',
        'source_record.row_index as rowIndex',
        'import_batch.id as importBatchId',
        'import_batch.source as importBatchSource',
        'import_batch.filename as filename',
      ])
      .where('summary.metric_date', '>=', from)
      .where('summary.metric_date', '<=', to)
      .orderBy('summary.metric_date', 'asc')
      .execute() as unknown as DailyExportDbRow[];
  }

  private async listActivityRows(from: string, to: string): Promise<ActivityExportDbRow[]> {
    return this.db
      .selectFrom('activities as activity')
      .leftJoin('source_records as source_record', 'source_record.id', 'activity.source_record_id')
      .leftJoin('import_batches as import_batch', 'import_batch.id', 'source_record.import_batch_id')
      .select([
        'activity.id as id',
        'activity.activity_date as activityDate',
        'activity.start_time as startTime',
        'activity.activity_type as activityType',
        'activity.subtype as subtype',
        'activity.source as source',
        'activity.source_activity_id as sourceActivityId',
        'activity.distance_m as distanceM',
        'activity.duration_s as durationS',
        'activity.moving_time_s as movingTimeS',
        'activity.steps as steps',
        'activity.calories as calories',
        'activity.avg_hr as avgHr',
        'activity.max_hr as maxHr',
        'activity.elevation_gain_m as elevationGainM',
        'activity.avg_speed_mps as avgSpeedMps',
        'activity.avg_pace_s_per_km as avgPaceSPerKm',
        'activity.effort_points as effortPoints',
        'activity.notes as notes',
        'source_record.id as sourceRecordId',
        'source_record.row_hash as sourceRecordHash',
        'source_record.source as sourceRecordSource',
        'source_record.sheet_name as sheetName',
        'source_record.row_index as rowIndex',
        'import_batch.id as importBatchId',
        'import_batch.source as importBatchSource',
        'import_batch.filename as filename',
      ])
      .where('activity.activity_date', '>=', from)
      .where('activity.activity_date', '<=', to)
      .orderBy('activity.activity_date', 'asc')
      .orderBy('activity.id', 'asc')
      .execute() as unknown as ActivityExportDbRow[];
  }

  private async listPerformanceRows(from: string, to: string): Promise<PerformanceExportDbRow[]> {
    return this.db
      .selectFrom('performance_events as event')
      .leftJoin('source_records as source_record', 'source_record.id', 'event.source_record_id')
      .leftJoin('import_batches as import_batch', 'import_batch.id', 'source_record.import_batch_id')
      .select([
        'event.id as id',
        'event.activity_id as activityId',
        'event.event_date as eventDate',
        'event.source as source',
        'event.distance_m as distanceM',
        'event.duration_s as durationS',
        'event.pace_s_per_km as paceSPerKm',
        'event.is_treadmill as isTreadmill',
        'event.is_race as isRace',
        'event.is_pr_marker as isPrMarker',
        'event.source_rank as sourceRank',
        'event.tags as tags',
        'event.notes as notes',
        'source_record.id as sourceRecordId',
        'source_record.row_hash as sourceRecordHash',
        'source_record.source as sourceRecordSource',
        'source_record.sheet_name as sheetName',
        'source_record.row_index as rowIndex',
        'import_batch.id as importBatchId',
        'import_batch.source as importBatchSource',
        'import_batch.filename as filename',
      ])
      .where('event.event_date', '>=', from)
      .where('event.event_date', '<=', to)
      .orderBy('event.event_date', 'asc')
      .orderBy('event.id', 'asc')
      .execute() as unknown as PerformanceExportDbRow[];
  }
}

function mapDailyRow(row: DailyExportDbRow): CanonicalDailyExportRow {
  return {
    metricDate: toIsoDate(row.metricDate),
    steps: Number(row.steps),
    runM: Number(row.runM),
    bikeM: Number(row.bikeM),
    swimM: Number(row.swimM),
    workoutPoints: Number(row.workoutPoints),
    powerPoints: Number(row.powerPoints),
    basePoints: Number(row.basePoints),
    bonusPoints: Number(row.bonusPoints),
    totalPoints: Number(row.totalPoints),
    excelAllPoints: nullableNumber(row.excelAllPoints),
    pointsDeltaVsExcel: nullableNumber(row.pointsDeltaVsExcel),
    reconciliationStatus: reconciliationStatus(row.excelAllPoints, row.pointsDeltaVsExcel),
    avg10d: nullableNumber(row.avg10d),
    avg20d: nullableNumber(row.avg20d),
    avg30d: nullableNumber(row.avg30d),
    avg60d: nullableNumber(row.avg60d),
    avg365d: nullableNumber(row.avg365d),
    recomputedAt: toIsoTimestamp(row.recomputedAt),
    provenance: mapProvenance(row, null),
  };
}

function mapActivityRow(row: ActivityExportDbRow): CanonicalActivityExportRow {
  return {
    id: row.id,
    activityDate: toIsoDate(row.activityDate),
    startTime: toNullableIsoTimestamp(row.startTime),
    activityType: row.activityType,
    subtype: row.subtype,
    source: row.source,
    sourceActivityId: row.sourceActivityId,
    distanceM: nullableNumber(row.distanceM),
    durationS: nullableNumber(row.durationS),
    movingTimeS: nullableNumber(row.movingTimeS),
    steps: nullableNumber(row.steps),
    calories: nullableNumber(row.calories),
    avgHr: nullableNumber(row.avgHr),
    maxHr: nullableNumber(row.maxHr),
    elevationGainM: nullableNumber(row.elevationGainM),
    avgSpeedMps: nullableNumber(row.avgSpeedMps),
    avgPaceSPerKm: nullableNumber(row.avgPaceSPerKm),
    effortPoints: nullableNumber(row.effortPoints),
    notes: row.notes,
    provenance: mapProvenance(row, row.source),
  };
}

function mapPerformanceRow(row: PerformanceExportDbRow): CanonicalPerformanceExportRow {
  return {
    id: row.id,
    activityId: row.activityId,
    eventDate: toIsoDate(row.eventDate),
    source: row.source,
    distanceM: Number(row.distanceM),
    durationS: Number(row.durationS),
    paceSPerKm: Number(row.paceSPerKm),
    isTreadmill: row.isTreadmill,
    isRace: row.isRace,
    isPrMarker: row.isPrMarker,
    sourceRank: row.sourceRank === null ? null : Number(row.sourceRank),
    tags: row.tags,
    notes: row.notes,
    provenance: mapProvenance(row, row.source),
  };
}

function mapProvenance(row: ProvenanceColumns, fallbackSource: string | null): ExportProvenance {
  const source = row.sourceRecordSource ?? row.importBatchSource ?? fallbackSource;
  if (row.sourceRecordId && row.importBatchId) {
    return {
      status: 'available',
      sourceRecordId: row.sourceRecordId,
      sourceRecordHash: row.sourceRecordHash,
      importBatchId: row.importBatchId,
      source,
      sheetName: row.sheetName,
      rowIndex: row.rowIndex,
      filename: row.filename,
    };
  }
  return {
    status: fallbackSource === 'manual' ? 'unsupported' : 'missing',
    sourceRecordId: null,
    sourceRecordHash: row.sourceRecordHash,
    importBatchId: null,
    source,
    sheetName: row.sheetName,
    rowIndex: row.rowIndex,
    filename: row.filename,
  };
}

function reconciliationStatus(excelTotal: number | null, delta: number | null): CanonicalDailyExportRow['reconciliationStatus'] {
  if (excelTotal === null) return 'not_comparable';
  return Number(delta) === 0 ? 'exact' : 'unresolved';
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value);
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new TypeError('Expected a database date value.');
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new TypeError('Expected a database timestamp value.');
}

function toNullableIsoTimestamp(value: unknown | null): string | null {
  return value === null ? null : toIsoTimestamp(value);
}
