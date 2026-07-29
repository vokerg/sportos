import { sql, type Kysely } from 'kysely';
import type { Database, NewPerformanceEvent, PerformanceEvent } from '../schema.js';

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
    return this.db
      .selectFrom('v_performance_events')
      .selectAll()
      .where('distance_m', '=', distanceM)
      .orderBy('duration_s', 'asc')
      .limit(limit)
      .execute();
  }
}
