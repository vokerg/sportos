import { scoreDay, type ActivityFact } from '@sportos/domain';
import { rowHash } from '@sportos/shared';
import {
  DailyRepository,
  ImportsRepository,
  PerformanceRepository,
  ScoringRepository,
  UploadsRepository,
  type Database,
  type ImportDiagnosticInput,
  type Json,
  type Kysely,
  type NewActivity,
  type NewPerformanceEvent,
  type NewSourceRecord,
  type SourceRecord,
} from '@sportos/db';
import { parseMySportWorkbook } from './my-sport.importer.js';
import { parseRunDbWorkbook } from './run-db.importer.js';
import { readWorkbook, type WorkbookExtract, type WorkbookRow } from './xlsx-reader.js';

export interface ImportLocalFilesInput {
  mySportPath?: string;
  runDbPath?: string;
}

export type ImportWorkbookKind = 'my_sport' | 'run_db';

export interface ImportWorkbookInput {
  workbookKind: ImportWorkbookKind;
  extract: WorkbookExtract;
  uploadId?: string;
}

export interface ImportLocalFilesResult {
  batches: { id: string; filename: string | null; source: string }[];
  dailyRows: number;
  activities: number;
  performanceEvents: number;
  warnings: string[];
}

export type ImportFailurePhase =
  | 'transaction-started'
  | 'raw-stored'
  | 'canonical-written'
  | 'daily-scored'
  | 'batch-finalized';

export interface ImportPhaseContext {
  batchId: string;
  source: 'my_sport_xlsx' | 'run_db_xlsx';
}

export interface ImportServiceOptions {
  failureInjector?: (phase: ImportFailurePhase, context: ImportPhaseContext) => void | Promise<void>;
}

export class ImportService {
  private readonly importsRepo: ImportsRepository;
  private readonly uploadsRepo: UploadsRepository;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly options: ImportServiceOptions = {},
  ) {
    this.importsRepo = new ImportsRepository(db);
    this.uploadsRepo = new UploadsRepository(db);
  }

  async importLocalFiles(input: ImportLocalFilesInput): Promise<ImportLocalFilesResult> {
    const result = emptyResult();

    if (input.mySportPath) await this.importMySportWorkbook(readWorkbook(input.mySportPath), result);
    if (input.runDbPath) await this.importRunDbWorkbook(readWorkbook(input.runDbPath), result);

    return result;
  }

  async importWorkbook(input: ImportWorkbookInput): Promise<ImportLocalFilesResult> {
    const result = emptyResult();
    if (input.workbookKind === 'my_sport') {
      await this.importMySportWorkbook(input.extract, result, input.uploadId);
    } else {
      await this.importRunDbWorkbook(input.extract, result, input.uploadId);
    }
    return result;
  }

  private async importMySportWorkbook(
    extract: WorkbookExtract,
    result: ImportLocalFilesResult,
    uploadId?: string,
  ): Promise<void> {
    const batch = await this.importsRepo.createBatch({
      source: 'my_sport_xlsx',
      sourceKind: 'xlsx',
      filename: extract.filename,
      originalSha256: extract.sha256,
      metadata: { sheets: extract.sheetNames, ...(uploadId ? { uploadId } : {}) },
    });
    if (uploadId) await this.uploadsRepo.linkBatch(uploadId, batch.id);
    result.batches.push({ id: batch.id, filename: batch.filename, source: batch.source });

    let phase: ImportFailurePhase = 'transaction-started';
    let normalizedCount = 0;
    let warningCount = 0;

    try {
      const committed = await this.db.transaction().execute(async (transaction) => {
        const importsRepo = new ImportsRepository(transaction);
        const dailyRepo = new DailyRepository(transaction);
        const scoringRepo = new ScoringRepository(transaction);

        await this.injectFailure(phase, { batchId: batch.id, source: 'my_sport_xlsx' });
        const sourceRecords = await this.storeRawRows(importsRepo, batch.id, 'my_sport_xlsx', extract.rows);
        const recordsByLocation = sourceRecordsByLocation(sourceRecords);
        const recordsByHash = new Map(sourceRecords.map((record) => [record.row_hash, record]));
        phase = 'raw-stored';
        await this.injectFailure(phase, { batchId: batch.id, source: 'my_sport_xlsx' });
        await importsRepo.updateBatchCounts(
          batch.id,
          { row_count: extract.rows.length, status: 'parsed' },
          'workbook-parsed',
        );

        const parsed = parseMySportWorkbook(extract);
        warningCount = parsed.warnings.length;
        const affectedDates = [...new Set(parsed.dailyMetrics.map((facts) => facts.metricDate))];
        await importsRepo.setAffectedDates(batch.id, affectedDates);
        await importsRepo.recordDiagnostics(batch.id, parserDiagnostics(parsed.warnings));

        const activityRows = parsed.activities.map((activity): NewActivity => {
          const sourceRecord = requireSourceRecord(recordsByLocation, activity.rawPayloadJson, 'activity');
          const identityHash = rowHash({
            sourceRowHash: sourceRecord.row_hash,
            entity: 'activity',
            activityType: activity.activityType,
            subtype: activity.subtype ?? 'unknown',
          });

          return {
            source: 'my_sport_xlsx',
            source_record_id: sourceRecord.id,
            source_activity_id: null,
            source_record_hash: identityHash,
            activity_date: activity.activityDate,
            start_time: activity.startTime ?? null,
            activity_type: activity.activityType,
            subtype: activity.subtype ?? 'unknown',
            distance_m: activity.distanceM ?? null,
            duration_s: activity.durationS ?? null,
            moving_time_s: activity.movingTimeS ?? null,
            steps: activity.steps ?? null,
            calories: activity.calories ?? null,
            avg_hr: activity.avgHr ?? null,
            max_hr: activity.maxHr ?? null,
            elevation_gain_m: activity.elevationGainM ?? null,
            avg_speed_mps: activity.avgSpeedMps ?? null,
            avg_pace_s_per_km: activity.avgPaceSPerKm ?? null,
            effort_points: activity.effortPoints ?? null,
            notes: activity.notes ?? null,
            raw_payload_json: toJson(activity.rawPayloadJson ?? {}),
          };
        });

        const upsertedActivities = await dailyRepo.upsertActivities(activityRows);
        normalizedCount = parsed.dailyMetrics.length + upsertedActivities.length;
        phase = 'canonical-written';
        await this.injectFailure(phase, { batchId: batch.id, source: 'my_sport_xlsx' });
        await importsRepo.updateBatchCounts(
          batch.id,
          {
            row_count: extract.rows.length,
            normalized_count: normalizedCount,
            warning_count: warningCount,
            status: 'normalized',
          },
          'canonical-written',
        );

        const canonicalActivities = await dailyRepo.listActivitiesForDates(affectedDates);
        const rules = await scoringRepo.listEnabledRules();
        const normalizedLinks: Array<{ sourceRecordId: string; entityType: 'daily_metric'; entityId: string }> = [];

        for (const facts of parsed.dailyMetrics) {
          const dailyActivities: ActivityFact[] = canonicalActivities
            .filter((activity) => activity.activity_date === facts.metricDate)
            .map(toActivityFact);
          const score = scoreDay(facts, dailyActivities, rules);
          const sourceRecord = facts.excelRowHash ? recordsByHash.get(facts.excelRowHash) : undefined;
          if (!sourceRecord) {
            throw new Error(`No source record found for daily metric ${facts.metricDate}.`);
          }

          await dailyRepo.upsertDailyMetric(facts, score, sourceRecord.id);
          await dailyRepo.replaceScoreLedger(facts.metricDate, score.ledger);
          normalizedLinks.push({ sourceRecordId: sourceRecord.id, entityType: 'daily_metric', entityId: facts.metricDate });
        }

        await importsRepo.markRecordsNormalized(normalizedLinks);
        phase = 'daily-scored';
        await this.injectFailure(phase, { batchId: batch.id, source: 'my_sport_xlsx' });

        await importsRepo.updateBatchCounts(
          batch.id,
          {
            row_count: extract.rows.length,
            normalized_count: normalizedCount,
            warning_count: warningCount,
            status: 'scored',
          },
          'daily-scored',
        );
        phase = 'batch-finalized';
        await this.injectFailure(phase, { batchId: batch.id, source: 'my_sport_xlsx' });

        return {
          dailyRows: parsed.dailyMetrics.length,
          activities: upsertedActivities.length,
          warnings: parsed.warnings,
        };
      });

      result.dailyRows += committed.dailyRows;
      result.activities += committed.activities;
      result.warnings.push(...committed.warnings);
    } catch (error) {
      await this.importsRepo.markBatchFailed(batch.id, {
        phase,
        error,
        attemptedCounts: {
          rowCount: extract.rows.length,
          normalizedCount,
          warningCount,
        },
      });
      throw error;
    }
  }

  private async importRunDbWorkbook(
    extract: WorkbookExtract,
    result: ImportLocalFilesResult,
    uploadId?: string,
  ): Promise<void> {
    const batch = await this.importsRepo.createBatch({
      source: 'run_db_xlsx',
      sourceKind: 'xlsx',
      filename: extract.filename,
      originalSha256: extract.sha256,
      metadata: { sheets: extract.sheetNames, ...(uploadId ? { uploadId } : {}) },
    });
    if (uploadId) await this.uploadsRepo.linkBatch(uploadId, batch.id);
    result.batches.push({ id: batch.id, filename: batch.filename, source: batch.source });

    let phase: ImportFailurePhase = 'transaction-started';
    let normalizedCount = 0;
    let warningCount = 0;

    try {
      const committed = await this.db.transaction().execute(async (transaction) => {
        const importsRepo = new ImportsRepository(transaction);
        const performanceRepo = new PerformanceRepository(transaction);

        await this.injectFailure(phase, { batchId: batch.id, source: 'run_db_xlsx' });
        const sourceRecords = await this.storeRawRows(importsRepo, batch.id, 'run_db_xlsx', extract.rows);
        const recordsByLocation = sourceRecordsByLocation(sourceRecords);
        phase = 'raw-stored';
        await this.injectFailure(phase, { batchId: batch.id, source: 'run_db_xlsx' });
        await importsRepo.updateBatchCounts(
          batch.id,
          { row_count: extract.rows.length, status: 'parsed' },
          'workbook-parsed',
        );

        const parsed = parseRunDbWorkbook(extract);
        warningCount = parsed.warnings.length;
        const affectedDates = [...new Set(parsed.events.map((event) => event.eventDate))];
        await importsRepo.setAffectedDates(batch.id, affectedDates);
        await importsRepo.recordDiagnostics(batch.id, parserDiagnostics(parsed.warnings));

        const rows = parsed.events.map((event): NewPerformanceEvent => {
          const sourceRecord = requireSourceRecord(recordsByLocation, event.rawPayloadJson, 'performance event');
          return {
            source: 'run_db_xlsx',
            source_record_id: sourceRecord.id,
            source_record_hash: sourceRecord.row_hash,
            activity_id: null,
            event_date: event.eventDate,
            distance_m: event.distanceM,
            duration_s: event.durationS,
            pace_s_per_km: event.paceSPerKm,
            is_treadmill: event.isTreadmill,
            is_race: event.isRace,
            is_pr_marker: event.isPrMarker,
            source_rank: event.sourceRank ?? null,
            tags: event.tags,
            notes: event.notes ?? null,
            raw_payload_json: toJson(event.rawPayloadJson ?? {}),
          };
        });

        const upserted = await performanceRepo.insertPerformanceEvents(rows);
        normalizedCount = upserted.length;
        await importsRepo.markRecordsNormalized(
          upserted.map((event) => {
            if (!event.source_record_id) throw new Error(`Performance event ${event.id} has no source record.`);
            return {
              sourceRecordId: event.source_record_id,
              entityType: 'performance_event' as const,
              entityId: event.id,
            };
          }),
        );

        phase = 'canonical-written';
        await this.injectFailure(phase, { batchId: batch.id, source: 'run_db_xlsx' });
        await importsRepo.updateBatchCounts(
          batch.id,
          {
            row_count: extract.rows.length,
            normalized_count: normalizedCount,
            warning_count: warningCount,
            status: 'normalized',
          },
          'canonical-written',
        );
        phase = 'batch-finalized';
        await this.injectFailure(phase, { batchId: batch.id, source: 'run_db_xlsx' });

        return { performanceEvents: upserted.length, warnings: parsed.warnings };
      });

      result.performanceEvents += committed.performanceEvents;
      result.warnings.push(...committed.warnings);
    } catch (error) {
      await this.importsRepo.markBatchFailed(batch.id, {
        phase,
        error,
        attemptedCounts: {
          rowCount: extract.rows.length,
          normalizedCount,
          warningCount,
        },
      });
      throw error;
    }
  }

  private async storeRawRows(
    importsRepo: ImportsRepository,
    batchId: string,
    source: string,
    rows: WorkbookRow[],
  ): Promise<SourceRecord[]> {
    const records: NewSourceRecord[] = rows.map((row) => ({
      import_batch_id: batchId,
      source,
      sheet_name: row.sheetName,
      row_index: row.rowIndex,
      source_record_key: sourceRecordLocationKey(row.sheetName, row.rowIndex),
      row_hash: row.hash,
      raw_json: toJson({ cells: row.cells }),
      status: 'raw',
      errors: [],
      warnings: [],
    }));
    return importsRepo.insertSourceRecords(records);
  }

  private async injectFailure(phase: ImportFailurePhase, context: ImportPhaseContext): Promise<void> {
    await this.options.failureInjector?.(phase, context);
  }
}

function emptyResult(): ImportLocalFilesResult {
  return {
    batches: [],
    dailyRows: 0,
    activities: 0,
    performanceEvents: 0,
    warnings: [],
  };
}

function parserDiagnostics(warnings: string[]): ImportDiagnosticInput[] {
  return warnings.map((message) => {
    const performanceRow = /^Skipped performance row '(.+)'!(\d+)\b/.exec(message);
    const dailyRow = /^Skipped (.+) row (\d+)\b/.exec(message);
    const quotedSheet = /sheet '([^']+)'/.exec(message);
    const rowIndex = Number(performanceRow?.[2] ?? dailyRow?.[2]);

    return {
      severity: 'warning',
      code: diagnosticCode(message),
      message,
      phase: 'parse',
      sheetName: performanceRow?.[1] ?? dailyRow?.[1] ?? quotedSheet?.[1] ?? null,
      rowIndex: Number.isInteger(rowIndex) && rowIndex > 0 ? rowIndex : null,
    };
  });
}

function diagnosticCode(message: string): string {
  if (/^Skipped performance row\b/.test(message) || /^Skipped .+ row \d+\b/.test(message)) return 'ROW_SKIPPED';
  if (/column\b/i.test(message)) return 'COLUMN_IGNORED';
  if (/sheet\b/i.test(message)) return 'SHEET_IGNORED';
  if (/^No daily metrics found\b/.test(message)) return 'NO_CANONICAL_ROWS';
  return 'IMPORT_WARNING';
}

function sourceRecordsByLocation(records: SourceRecord[]): Map<string, SourceRecord> {
  return new Map(
    records.flatMap((record) =>
      record.sheet_name !== null && record.row_index !== null
        ? [[sourceRecordLocationKey(record.sheet_name, record.row_index), record] as const]
        : [],
    ),
  );
}

function sourceRecordLocationKey(sheetName: string, rowIndex: number): string {
  return `${sheetName}:${rowIndex}`;
}

function requireSourceRecord(
  recordsByLocation: Map<string, SourceRecord>,
  rawPayload: Record<string, unknown>,
  entityName: string,
): SourceRecord {
  const sheetName = typeof rawPayload.sheetName === 'string' ? rawPayload.sheetName : undefined;
  const rowIndex = typeof rawPayload.rowIndex === 'number' ? rawPayload.rowIndex : undefined;
  const record = sheetName !== undefined && rowIndex !== undefined
    ? recordsByLocation.get(sourceRecordLocationKey(sheetName, rowIndex))
    : undefined;
  if (!record) throw new Error(`No source record found for normalized ${entityName}.`);
  return record;
}

function toActivityFact(activity: Awaited<ReturnType<DailyRepository['listActivitiesForDates']>>[number]): ActivityFact {
  return {
    id: activity.id,
    activityDate: activity.activity_date,
    activityType: activity.activity_type,
    subtype: activity.subtype ?? 'unknown',
    distanceM: activity.distance_m ?? undefined,
    durationS: activity.duration_s ?? undefined,
    steps: activity.steps ?? undefined,
    avgSpeedMps: activity.avg_speed_mps ?? undefined,
    effortPoints: activity.effort_points ?? undefined,
  };
}

function toJson(value: unknown): Json {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return null;
  return JSON.parse(serialized) as Json;
}
