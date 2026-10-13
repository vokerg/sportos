import type { GeneratedTimestamp, Json, OwnerId } from './schema.js';
/** Auxiliary detail DB only: primary DB owns canonical links and provider currentness. */
export interface ActivityRouteProjectionsTable {
 owner_id: OwnerId; activity_id: string;
 provider: 'strava' | 'garmin'; resolution: 'streams' | 'detail' | 'fit';
 source_ref: string; source_version: string; resource_hash: string;
 algorithm_version: number; polylines: Json; bounds: Json; point_count: number;
 source_fetched_at: Date; state: 'current' | 'stale'; updated_at: GeneratedTimestamp;
}
