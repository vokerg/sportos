import { sql, type Kysely } from 'kysely';
import type { Database, NewPerformanceEvent, PerformanceEvent } from '../schema.js';

export interface PerformanceEventQuery {
  distanceM?: number;
  from?: string;
  to?: string;
  limit?: number;
}

export interface PerformanceEventListItem {
  id: string;
  activityId: string | null;
  eventDate: string;
  source: PerformanceEvent['source'];
  distanceM: number;
  durationS: number;
  paceSPerKm: number;
  isTreadmill: boolean;
  isRace: boolean;
  isPrMarker: boolean;
  isPrByTime: boolean;
  sourceRank: number | null;
  allTimeRank: number;
  tags: string[];
  notes: string | null;
}

export interface PerformanceEventDetail extends PerformanceEventListItem {
  provenance: {
    status: 'available' | 'missing' | 'unsupported';
    sourceRecordId: string | null;
    sourceRecordHash: string | null;
    importBatchId: string | null;
    source: string | null;
    sheetName: string | null;
    rowIndex: number | null;
    filename: string | null;
  };
}

export class PerformanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insertPerformanceEvents(rows: NewPerformanceEvent[]): Promise<PerformanceEvent[]> {
    if (rows.length === 0) return [];
    const upserted: PerformanceEvent[] = [];
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      upserted.push(
        ...(await this.db
          .insertInto('performance_events')
          .values(chunk)
          .onConflict((oc) =>
            oc.columns(['source', 'source_record_hash']).doUpdateSet({
              activity_id: sql`excluded.activity_id`,
              source_record_id: sql`excluded.source_record_id`,
              event_date: sql`excluded.event_date`,
              distance_m: sql`excluded.distance_m`,
              duration_s: sql`excluded.duration_s`,
              pace_s_per_km: sql`excluded.pace_s_per_km`,
              is_treadmill: sql`excluded.is_treadmill`,
              is_race: sql`excluded.is_race`,
              is_pr_marker: sql`excluded.is_pr_marker`,
              source_rank: sql`excluded.source_rank`,
              tags: sql`excluded.tags`,
              notes: sql`excluded.notes`,
              raw_payload_json: sql`excluded.raw_payload_json`,
            }),
          )
          .returningAll()
          .execute()),
      );
    }
    return upserted;
  }

  async listBestByDistance(distanceM: number, limit = 25) {
    const rows = await this.db
      .selectFrom('v_performance_events')
      .select([
        'event_date',
        'distance_m',
        'duration_s',
        'pace_s_per_km',
        'is_treadmill',
        'is_pr_marker',
        'source_rank',
        'all_time_rank',
        'tags',
      ])
      .where('distance_m', '=', distanceM)
      .orderBy('duration_s', 'asc')
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      event_date: toIsoDate(row.event_date),
      distance_m: Number(row.distance_m),
      duration_s: Number(row.duration_s),
      pace_s_per_km: Number(row.pace_s_per_km),
      is_treadmill: row.is_treadmill,
      is_pr_marker: row.is_pr_marker,
      source_rank: row.source_rank === null ? null : Number(row.source_rank),
      all_time_rank: Number(row.all_time_rank),
      tags: row.tags,
    }));
  }

  async listEvents(input: PerformanceEventQuery = {}): Promise<PerformanceEventListItem[]> {
    let query = this.db
      .selectFrom('v_performance_events')
      .select([
        'id',
        'activity_id',
        'event_date',
        'source',
        'distance_m',
        'duration_s',
        'pace_s_per_km',
        'is_treadmill',
        'is_race',
        'is_pr_marker',
        'is_pr_by_time',
        'source_rank',
        'all_time_rank',
        'tags',
        'notes',
      ]);
    if (input.distanceM !== undefined) query = query.where('distance_m', '=', input.distanceM);
    if (input.from !== undefined) query = query.where('event_date', '>=', input.from);
    if (input.to !== undefined) query = query.where('event_date', '<=', input.to);
    const rows = await query
      .orderBy('event_date', 'desc')
      .orderBy('duration_s', 'asc')
      .orderBy('id', 'asc')
      .limit(input.limit ?? 100)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      activityId: row.activity_id,
      eventDate: toIsoDate(row.event_date),
      source: row.source,
      distanceM: Number(row.distance_m),
      durationS: Number(row.duration_s),
      paceSPerKm: Number(row.pace_s_per_km),
      isTreadmill: row.is_treadmill,
      isRace: row.is_race,
      isPrMarker: row.is_pr_marker,
      isPrByTime: row.is_pr_by_time,
      sourceRank: row.source_rank === null ? null : Number(row.source_rank),
      allTimeRank: Number(row.all_time_rank),
      tags: row.tags,
      notes: row.notes,
    }));
  }

  async getEventDetail(eventId: string): Promise<PerformanceEventDetail | null> {
    const row = await this.db
      .selectFrom('v_performance_events as event')
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
        'event.is_pr_by_time as isPrByTime',
        'event.source_rank as sourceRank',
        'event.all_time_rank as allTimeRank',
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
      .where('event.id', '=', eventId)
      .executeTakeFirst();
    if (!row) return null;
    const traceable = row.sourceRecordId !== null && row.importBatchId !== null;
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
      isPrByTime: row.isPrByTime,
      sourceRank: row.sourceRank === null ? null : Number(row.sourceRank),
      allTimeRank: Number(row.allTimeRank),
      tags: row.tags,
      notes: row.notes,
      provenance: {
        status: traceable ? 'available' : row.source === 'manual' ? 'unsupported' : 'missing',
        sourceRecordId: traceable ? row.sourceRecordId : null,
        sourceRecordHash: row.sourceRecordHash,
        importBatchId: traceable ? row.importBatchId : null,
        source: row.sourceRecordSource ?? row.importBatchSource ?? row.source,
        sheetName: row.sheetName,
        rowIndex: row.rowIndex,
        filename: row.filename,
      },
    };
  }
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new TypeError('Expected a database date value.');
}
