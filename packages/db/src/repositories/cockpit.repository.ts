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
    const rows = await query
      .orderBy('metric_date', 'desc')
      .limit(input.limit ?? 365)
      .execute();
    return rows.map((row) => ({ ...row, metric_date: toIsoDate(row.metric_date) }));
  }
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new TypeError('Expected a database date value.');
}
