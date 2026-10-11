import { sql, type Kysely } from 'kysely';
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
      .select(sql<{ strava: boolean; garmin: boolean }>`jsonb_build_object(
        'strava', exists(select 1 from activities a where a.owner_id = sportos_current_account_id()
          and a.activity_date = v_daily_summary.metric_date and (a.source = 'strava' or exists(
            select 1 from provider_activity_links p join provider_connections c on c.owner_id=p.owner_id and c.id=p.connection_id
            where p.owner_id=a.owner_id and p.activity_id=a.id and p.availability='available' and c.provider='strava'))),
        'garmin', exists(select 1 from garmin_activity_identities g join activities a on a.owner_id=g.owner_id and a.id=g.activity_id
          where g.owner_id=sportos_current_account_id() and a.activity_date=v_daily_summary.metric_date)
          or exists(select 1 from garmin_day_versions d where d.owner_id=sportos_current_account_id()
            and d.calendar_date=v_daily_summary.metric_date and d.availability='available')
          or exists(select 1 from garmin_observations o where o.owner_id=sportos_current_account_id()
            and o.recorded_date=v_daily_summary.metric_date)
      )`.as('providerSources'))
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
