import { sql, type Kysely } from 'kysely';
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
  /** Primary-owner-verified source references; never derived from auxiliary data. */
  stravaLinked?: boolean;
  stravaProviderActivityId?: string | null;
  stravaProviderVersion?: string | null;
  trustedProviderActivityId?: string | null;
  trustedProviderVersion?: string | null;
  garminIdentityKey?: string | null;
  garminCurrentHash?: string | null;
}

/** One account-scoped database page: no per-activity lookup, no provider IO. */
export class HeatmapRoutesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async list(input: HeatmapRoutesQuery): Promise<{ candidates: HeatmapRouteCandidate[]; hasMore: boolean }> {
    // LATERAL resolves at most one trusted source for each candidate using the
    // existing (owner_id, activity_id) link index. A global DISTINCT ON would
    // decode/sort the entire archive before pagination on every request.
    let query = this.db.selectFrom('activities as activity')
      .leftJoinLateral(
        () => trustedStravaRouteSources(this.db)
          .where('link.activity_id', '=', sql<string>`activity.id`)
          .where('link.owner_id', '=', sql<string>`activity.owner_id`)
          .orderBy('link.updated_at', 'desc')
          .orderBy('link.id', 'desc')
          .limit(1)
          .as('route'),
        join => join.onTrue(),
      )
      // Resolve available provider identities in the same bounded SQL page.
      // A Strava link blocks Garmin even if its summary is missing or invalid.
      .leftJoinLateral(
        () => this.db.selectFrom('provider_activity_links as sl')
          .innerJoin('provider_connections as sc', join => join
            .onRef('sc.id', '=', 'sl.connection_id')
            .onRef('sc.owner_id', '=', 'sl.owner_id')
            .on('sc.provider', '=', 'strava'))
          .leftJoin('source_records as ss', join => join
            .onRef('ss.id', '=', 'sl.latest_source_record_id')
            .onRef('ss.owner_id', '=', 'sl.owner_id'))
          .where('sl.activity_id', '=', sql<string>`activity.id`)
          .where('sl.owner_id', '=', sql<string>`activity.owner_id`)
          .where('sl.availability', '=', 'available')
          .select(['sl.activity_id as activityId', 'sl.provider_activity_id as providerActivityId',
            'ss.row_hash as providerVersion'])
          .orderBy('sl.updated_at', 'desc').orderBy('sl.id', 'desc').limit(1).as('stravaRef'),
        join => join.onTrue(),
      )
      .leftJoinLateral(
        () => this.db.selectFrom('garmin_activity_identities as gi')
          .where('gi.activity_id', '=', sql<string>`activity.id`)
          .where('gi.owner_id', '=', sql<string>`activity.owner_id`)
          .select(['gi.identity_key as identityKey', 'gi.current_hash as currentHash'])
          .orderBy('gi.updated_at', 'desc').limit(1).as('garminRef'),
        join => join.onTrue(),
      )
      .where(eb => eb.or([
        eb('route.activityId', 'is not', null),
        eb.and([eb('garminRef.identityKey', 'is not', null), eb('stravaRef.activityId', 'is', null)]),
      ]))
      .select([
        'activity.id as activityId',
        'activity.activity_date as date',
        'activity.activity_type as sport',
        'route.polyline as polyline',
        'route.polylineType as polylineType',
        'route.providerActivityId as trustedProviderActivityId',
        'route.providerVersion as trustedProviderVersion',
        'stravaRef.activityId as stravaLinkId',
        'stravaRef.providerActivityId as stravaProviderActivityId',
        'stravaRef.providerVersion as stravaProviderVersion',
        'garminRef.identityKey as garminIdentityKey',
        'garminRef.currentHash as garminCurrentHash',
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
      candidates: rows.slice(0, input.limit).map(({ stravaLinkId, ...row }) => ({
        ...row,
        stravaLinked: stravaLinkId !== null,
        date: (row.date as unknown) instanceof Date ? (row.date as unknown as Date).toISOString().slice(0, 10) : row.date,
      })),
    };
  }
}
