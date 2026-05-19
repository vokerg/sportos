import type { Kysely } from 'kysely';
import type { Database, NewPerformanceEvent } from '../schema.js';

export class PerformanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insertPerformanceEvents(rows: NewPerformanceEvent[]) {
    if (rows.length === 0) return [];
    return this.db.insertInto('performance_events').values(rows).returningAll().execute();
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
