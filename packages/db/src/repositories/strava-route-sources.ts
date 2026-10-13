import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

/**
 * Only latest normalized Strava snapshots attached through an available native
 * provider link are trusted. This is shared by single-activity and bulk maps.
 * Reading at most 30,001 characters prevents oversized retained payloads from
 * crossing the repository boundary; the route decoder rejects >30,000.
 */
export function trustedStravaRouteSources(db: Kysely<Database>) {
  return db.selectFrom('provider_activity_links as link')
    .innerJoin('provider_connections as connection', join => join
      .onRef('connection.id', '=', 'link.connection_id')
      .onRef('connection.owner_id', '=', 'link.owner_id')
      .on('connection.provider', '=', 'strava'))
    .innerJoin('source_records as snapshot', join => join
      .onRef('snapshot.id', '=', 'link.latest_source_record_id')
      .onRef('snapshot.owner_id', '=', 'link.owner_id')
      .on('snapshot.source', '=', 'strava_api')
      .on('snapshot.status', '=', 'normalized')
      .on('snapshot.normalized_entity_type', '=', 'activity')
      .on('snapshot.normalized_entity_id', '=', sql<string>`link.activity_id::text`)
      .onRef('snapshot.source_record_key', '=', 'link.provider_activity_id'))
    .where('link.availability', '=', 'available')
    .select([
      'link.activity_id as activityId',
      'link.owner_id as ownerId',
      sql<string | null>`left(snapshot.raw_json #>> '{map,summary_polyline}', 30001)`.as('polyline'),
      sql<string | null>`jsonb_typeof(snapshot.raw_json #> '{map,summary_polyline}')`.as('polylineType'),
    ])
    .distinctOn('link.activity_id')
    .orderBy('link.activity_id')
    .orderBy('link.updated_at', 'desc')
    .orderBy('link.id', 'desc');
}
