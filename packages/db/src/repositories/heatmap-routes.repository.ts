import type { Kysely } from 'kysely';
import type { Activity, Database } from '../schema.js';
import { trustedStravaRouteSources } from './strava-route-sources.js';

export interface HeatmapRoutesQuery {
  from?: string;
  to?: string;
  activityType?: Activity['activity_type'];
  limit: number;
  cursor?: { date: string; id: string };
}

export interface HeatmapRouteCandidate {
  activityId: string;
  date: string;
  sport: Activity['activity_type'];
  polyline: string | null;
  polylineType: string | null;
}

/** One account-scoped database page: no per-activity lookup, no provider IO. */
export class HeatmapRoutesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async list(input: HeatmapRoutesQuery): Promise<{ candidates: HeatmapRouteCandidate[]; hasMore: boolean }> {
    const trusted = trustedStravaRouteSources(this.db).as('route');
    let query = this.db.selectFrom('activities as activity')
      .innerJoin(trusted, join => join
        .onRef('route.activityId', '=', 'activity.id')
        .onRef('route.ownerId', '=', 'activity.owner_id'))
      .select([
        'activity.id as activityId',
        'activity.activity_date as date',
        'activity.activity_type as sport',
        'route.polyline as polyline',
        'route.polylineType as polylineType',
      ]);
    if (input.from) query = query.where('activity.activity_date', '>=', input.from);
    if (input.to) query = query.where('activity.activity_date', '<=', input.to);
    if (input.activityType) query = query.where('activity.activity_type', '=', input.activityType);
    if (input.cursor) {
      const cursor = input.cursor;
      query = query.where(eb => eb.or([
        eb('activity.activity_date', '<', cursor.date),
        eb.and([
          eb('activity.activity_date', '=', cursor.date),
          eb('activity.id', '<', cursor.id),
        ]),
      ]));
    }
    const rows = await query
      .orderBy('activity.activity_date', 'desc')
      .orderBy('activity.id', 'desc')
      .limit(input.limit + 1)
      .execute();
    return {
      hasMore: rows.length > input.limit,
      candidates: rows.slice(0, input.limit).map(row => ({
        ...row,
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date,
      })),
    };
  }
}
