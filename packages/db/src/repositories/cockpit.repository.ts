import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export interface DailySummaryQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export class CockpitRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listDailySummary(input: DailySummaryQuery = {}) {
    let query = this.db
      .selectFrom('v_daily_summary')
      .selectAll()
      .where('metric_date', '<=', input.to ?? new Date().toISOString().slice(0, 10));
    if (input.from !== undefined) query = query.where('metric_date', '>=', input.from);
    return query
      .orderBy('metric_date', 'desc')
      .limit(input.limit ?? 365)
      .execute();
  }
}
