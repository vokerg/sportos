import type { Kysely } from 'kysely';
import { scoreDay, type ActivityFact } from '@sportos/domain';
import { rowHash } from '@sportos/shared';
import { DailyRepository, ImportsRepository, PerformanceRepository, ScoringRepository, type Database, type NewActivity, type NewPerformanceEvent, type NewSourceRecord } from '@sportos/db';
import { parseMySportWorkbook } from './my-sport.importer.js';
import { parseRunDbWorkbook } from './run-db.importer.js';
import { readWorkbook } from './xlsx-reader.js';

export interface ImportLocalFilesInput {
  mySportPath?: string;
  runDbPath?: string;
}

export interface ImportLocalFilesResult {
  batches: { id: string; filename: string | null; source: string }[];
  dailyRows: number;
  activities: number;
  performanceEvents: number;
  warnings: string[];
}

export class ImportService {
  private readonly importsRepo: ImportsRepository;
  private readonly dailyRepo: DailyRepository;
  private readonly perfRepo: PerformanceRepository;
  private readonly scoringRepo: ScoringRepository;

  constructor(private readonly db: Kysely<Database>) {
    this.importsRepo = new ImportsRepository(db);
    this.dailyRepo = new DailyRepository(db);
    this.perfRepo = new PerformanceRepository(db);
    this.scoringRepo = new ScoringRepository(db);
  }

  async importLocalFiles(input: ImportLocalFilesInput): Promise<ImportLocalFilesResult> {
    const result: ImportLocalFilesResult = { batches: [], dailyRows: 0, activities: 0, performanceEvents: 0, warnings: [] };

    if (input.mySportPath) {
      const extract = readWorkbook(input.mySportPath);
      const batch = await this.importsRepo.createBatch({
        source: 'my_sport_xlsx',
        sourceKind: 'xlsx',
        filename: extract.filename,
        originalSha256: extract.sha256,
        metadata: { sheets: extract.sheetNames },
      });
      result.batches.push({ id: batch.id, filename: batch.filename, source: batch.source });
      await this.storeRawRows(batch.id, 'my_sport_xlsx', extract.rows);

      const parsed = parseMySportWorkbook(extract);
      result.warnings.push(...parsed.warnings);

      const activities = parsed.activities.map((activity): NewActivity => ({
        source: 'my_sport_xlsx',
        source_record_id: null,
        source_activity_id: null,
        source_record_hash: rowHash(activity),
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
        raw_payload_json: activity.rawPayloadJson ?? {},
      }));

      const insertedActivities = await this.dailyRepo.upsertActivities(activities);
      const rules = await this.scoringRepo.listEnabledRules();
      for (const facts of parsed.dailyMetrics) {
        const dailyActivities: ActivityFact[] = insertedActivities
          .filter((a) => a.activity_date === facts.metricDate)
          .map((a) => ({
            id: a.id,
            activityDate: a.activity_date,
            activityType: a.activity_type,
            subtype: a.subtype ?? 'unknown',
            distanceM: a.distance_m ?? undefined,
            durationS: a.duration_s ?? undefined,
            steps: a.steps ?? undefined,
            avgSpeedMps: a.avg_speed_mps ?? undefined,
            effortPoints: a.effort_points ?? undefined,
          }));
        const score = scoreDay(facts, dailyActivities, rules);
        await this.dailyRepo.upsertDailyMetric(facts, score);
        await this.dailyRepo.replaceScoreLedger(facts.metricDate, score.ledger);
      }

      await this.importsRepo.updateBatchCounts(batch.id, {
        row_count: extract.rows.length,
        normalized_count: parsed.dailyMetrics.length + insertedActivities.length,
        warning_count: parsed.warnings.length,
        status: 'scored',
      });

      result.dailyRows += parsed.dailyMetrics.length;
      result.activities += insertedActivities.length;
    }

    if (input.runDbPath) {
      const extract = readWorkbook(input.runDbPath);
      const batch = await this.importsRepo.createBatch({
        source: 'run_db_xlsx',
        sourceKind: 'xlsx',
        filename: extract.filename,
        originalSha256: extract.sha256,
        metadata: { sheets: extract.sheetNames },
      });
      result.batches.push({ id: batch.id, filename: batch.filename, source: batch.source });
      await this.storeRawRows(batch.id, 'run_db_xlsx', extract.rows);

      const parsed = parseRunDbWorkbook(extract);
      result.warnings.push(...parsed.warnings);
      const rows: NewPerformanceEvent[] = parsed.events.map((event) => ({
        source: 'run_db_xlsx',
        source_record_id: null,
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
        raw_payload_json: event.rawPayloadJson ?? {},
      }));
      const inserted = await this.perfRepo.insertPerformanceEvents(rows);
      await this.importsRepo.updateBatchCounts(batch.id, {
        row_count: extract.rows.length,
        normalized_count: inserted.length,
        warning_count: parsed.warnings.length,
        status: 'normalized',
      });
      result.performanceEvents += inserted.length;
    }

    return result;
  }

  private async storeRawRows(batchId: string, source: string, rows: { sheetName: string; rowIndex: number; cells: unknown[]; hash: string }[]) {
    const records: NewSourceRecord[] = rows.map((row) => ({
      import_batch_id: batchId,
      source,
      sheet_name: row.sheetName,
      row_index: row.rowIndex,
      source_record_key: `${row.sheetName}:${row.rowIndex}`,
      row_hash: row.hash,
      raw_json: { cells: row.cells },
      status: 'raw',
      errors: [],
      warnings: [],
    }));
    await this.importsRepo.insertSourceRecords(records);
  }
}
