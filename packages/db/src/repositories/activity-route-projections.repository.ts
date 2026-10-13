import { sql, type Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';
import type { ActivityRouteProjectionsTable } from '../activity-route-projection-schema.js';
export type RouteProjectionWrite = Pick<ActivityRouteProjectionsTable,
 'activity_id'|'provider'|'resolution'|'source_ref'|'source_version'|'resource_hash'|
 'algorithm_version'|'point_count'|'source_fetched_at'> & {
 polylines: string[]; bounds: [number,number,number,number];
};
/** Always invoked through activity-detail withAccountContext, after primary link check. */
export class ActivityRouteProjectionsRepository {
 constructor(private readonly db: Kysely<Database>) {}
 async get(activityId:string) {
  return this.db.selectFrom('activity_route_projections').selectAll()
   .where('activity_id','=',activityId).executeTakeFirst();
 }
 /** Mutable Strava resources: invalidate BEFORE replacing retained evidence. */
 async invalidate(activityId:string) {
  await this.db.updateTable('activity_route_projections').set({state:'stale',updated_at:new Date()})
   .where('activity_id','=',activityId).where('provider','=','strava').execute();
 }
 async publish(write:RouteProjectionWrite) {
  if (!/^[a-f0-9]{64}$/.test(write.source_version) || !/^[a-f0-9]{64}$/.test(write.resource_hash)
    || write.point_count < 2 || write.point_count > 3000 || write.polylines.length < 1 || write.polylines.length > 50
    || write.polylines.some(x=>typeof x!=='string'||!x.length||x.length>30000)
    || JSON.stringify(write.polylines).length > 59000 || write.bounds.length!==4
    || write.bounds.some(x=>!Number.isFinite(x)) || !Number.isFinite(write.source_fetched_at.getTime()))
    throw new Error('Invalid bounded route projection');
  const jsonb=(value:unknown) => sql<Json>`${JSON.stringify(value)}::jsonb`;
  const values={...write,polylines:jsonb(write.polylines),bounds:jsonb(write.bounds),
    state:'current' as const,updated_at:new Date()};
  return this.db.insertInto('activity_route_projections').values(values)
   .onConflict(oc=>oc.columns(['owner_id','activity_id']).doUpdateSet({
    provider:values.provider,resolution:values.resolution,source_ref:values.source_ref,
    source_version:values.source_version,resource_hash:values.resource_hash,
    algorithm_version:values.algorithm_version,polylines:values.polylines,
    bounds:values.bounds,point_count:values.point_count,
    source_fetched_at:values.source_fetched_at,state:'current',updated_at:values.updated_at,
   }).where('activity_route_projections.source_fetched_at','<=',write.source_fetched_at))
   .returning('activity_id').executeTakeFirst();
 }
}
