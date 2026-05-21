import type { Kysely } from 'kysely';
import type { Database, NewPerformanceEvent } from '../schema.js';

export class PerformanceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insertPerformanceEvents(rows: NewPerformanceEvent[]) {
    if (rows.length === 0) return [];
    const inserted = [];
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      inserted.push(...(await this.db.insertInto('performance_events').values(chunk).returningAll().execute()));
    }
    return inserted;
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
