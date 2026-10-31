import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';
import { effectiveDistanceExpression, effectivePaceExpression, effectiveSpeedExpression } from './activity-distance-corrections.repository.js';

export type PaceSpeedSport = 'run' | 'bike' | 'swim';
export type PaceSpeedGrain = 'daily' | 'weekly' | 'monthly';

export interface PaceSpeedTrendQuery {
  from: string;
  to: string;
  sport: PaceSpeedSport;
  granularity: PaceSpeedGrain;
  /** Null means no threshold; otherwise min/km, min/100m or km/h, in seconds or km/h respectively. */
  threshold: number | null;
}

export interface PaceSpeedTrendBucket {
  key: string;
  totalDistanceM: number;
  includedDistanceM: number;
  includedTimeS: number;
  activities: number;
  includedActivities: number;
  value: number | null;
}

export interface PaceSpeedTrendResponse {
  range: { from: string; to: string };
  sport: PaceSpeedSport;
  granularity: PaceSpeedGrain;
  threshold: number | null;
  buckets: PaceSpeedTrendBucket[];
}

/** One grouped, owner-scoped canonical read. Caller must use withAccountContext. */
export class PaceSpeedTrendsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async read(query: PaceSpeedTrendQuery): Promise<PaceSpeedTrendResponse> {
    const distance = effectiveDistanceExpression('a');
    const reportedPace = effectivePaceExpression('a');
    const reportedSpeed = effectiveSpeedExpression('a');
    const scale = query.sport === 'swim' ? 100 : 1000;
    // A recorded time is preferred. For older summaries lacking time, derive it
    // from the canonical reported speed/pace rather than silently dropping them.
    // The effective metric expressions already account for distance corrections.
    const accepted = query.threshold === null
      ? sql<boolean>`distance_m > 0 and seconds > 0`
      : query.sport === 'bike'
        ? sql<boolean>`distance_m > 0 and seconds > 0 and distance_m * 3.6 / nullif(seconds, 0) >= ${query.threshold}`
        : sql<boolean>`distance_m > 0 and seconds > 0 and seconds * ${scale} / nullif(distance_m, 0) <= ${query.threshold}`;

    const result = await sql<{
      key: string;
      total_distance_m: string | number;
      included_distance_m: string | number;
      included_time_s: string | number;
      activities: string | number;
      included_activities: string | number;
    }>`
      with samples as (
        select a.activity_date as activity_day,
          ${distance} as distance_m,
          coalesce(
            nullif(a.moving_time_s, 0),
            nullif(a.duration_s, 0),
            case when ${reportedPace} > 0 and ${distance} > 0
              then ${reportedPace} * ${distance} / 1000.0 end,
            case when ${reportedSpeed} > 0 and ${distance} > 0
              then ${distance} / ${reportedSpeed} end
          ) as seconds
        from activities a
        where a.activity_type = ${query.sport}
          and a.activity_date between ${query.from}::date and ${query.to}::date
      )
      select to_char(date_trunc(${query.granularity === 'weekly' ? 'week' : query.granularity === 'monthly' ? 'month' : 'day'}, activity_day::timestamp), 'YYYY-MM-DD') as key,
        coalesce(sum(greatest(coalesce(distance_m, 0), 0)), 0) as total_distance_m,
        coalesce(sum(case when ${accepted} then distance_m else 0 end), 0) as included_distance_m,
        coalesce(sum(case when ${accepted} then seconds else 0 end), 0) as included_time_s,
        count(*) as activities,
        count(*) filter (where ${accepted}) as included_activities
      from samples
      group by 1
      order by 1
    `.execute(this.db);

    const buckets = result.rows.map((row) => {
      const includedDistanceM = Number(row.included_distance_m);
      const includedTimeS = Number(row.included_time_s);
      return {
        key: row.key,
        totalDistanceM: Number(row.total_distance_m),
        includedDistanceM,
        includedTimeS,
        activities: Number(row.activities),
        includedActivities: Number(row.included_activities),
        value: includedDistanceM > 0 && includedTimeS > 0
          ? query.sport === 'bike' ? includedDistanceM * 3.6 / includedTimeS : includedTimeS * scale / includedDistanceM
          : null,
      };
    });
    return { range: { from: query.from, to: query.to }, sport: query.sport, granularity: query.granularity, threshold: query.threshold, buckets };
  }
}
