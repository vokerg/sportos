import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityProviderResourcesRepository, ActivityRouteProjectionsRepository,
 ActivitiesRepository, GarminActivityResourcesRepository, sql, type Json } from '@sportos/db';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { stravaSummaryRoute, type ActivityRouteResponse } from './activity-route.js';
import { decodeStoredRoute, projectGarminRoute, projectStravaRoute,
 ROUTE_ALGORITHM_VERSION, type ProjectedRoute } from './activity-route-projection.js';
type RouteRefs = {
 summary: Awaited<ReturnType<ActivitiesRepository['getStravaRouteEvidence']>>;
  activityType: string;
  activitySubtype: string | null;
 strava: Awaited<ReturnType<ActivityProviderResourcesRepository['getProviderReference']>>;
 garmin: {identity_key:string;current_hash:string}|undefined;
 stravaLinked: boolean;
};
/** No provider/credential imports; all reprocessing uses retained resources. */
@Injectable()
export class ActivityRouteProjectionService {
 constructor(private readonly primary:DbProvider,private readonly detail:ActivityDetailDbProvider){}
 private async references(owner:string,id:string):Promise<RouteRefs> {
  return this.primary.withAccount(owner,async db=>{
   const activity=await db.selectFrom('activities').select(['activity_type','subtype']).where('id','=',id).executeTakeFirst();
   if(!activity)throw new NotFoundException({code:'ACTIVITY_NOT_FOUND',message:'Activity was not found.'});
   const summary=await new ActivitiesRepository(db).getStravaRouteEvidence(id);
   if(!summary)throw new NotFoundException({code:'ACTIVITY_NOT_FOUND',message:'Activity was not found.'});
   // A linked Strava identity can exist without a trustworthy summary; do not
   // reveal a less-redacted Garmin FIT route in that situation.
   const stravaLink=await db.selectFrom('provider_activity_links as link')
    .innerJoin('provider_connections as connection',j=>j.onRef('connection.owner_id','=','link.owner_id')
     .onRef('connection.id','=','link.connection_id').on('connection.provider','=','strava'))
    .select('link.id').where('link.activity_id','=',id).where('link.availability','=','available').executeTakeFirst();
   const stravaLinked=Boolean(stravaLink);
   const strava=summary.linked?await new ActivityProviderResourcesRepository(db).getProviderReference(id):null;
   const garmin=await db.selectFrom('garmin_activity_identities')
    .select(['identity_key','current_hash']).where('activity_id','=',id).executeTakeFirst();
   return {summary,activityType:activity.activity_type,activitySubtype:activity.subtype,strava,garmin,stravaLinked};
  });
 }
 async read(owner:string,id:string):Promise<ActivityRouteResponse> {
  const ref=await this.references(owner,id);
  if(ref.activityType==='swim'&&ref.activitySubtype==='indoor')return {status:'unavailable',reason:'indoor_pool_swim'};
  const summary=ref.summary!.linked?stravaSummaryRoute(ref.summary!.polyline,ref.summary!.polylineType)
    :{status:'unavailable' as const,reason:'no_gps' as const};
  // The compact auxiliary projection is an optional upgrade. Missing V004,
  // transient detail DB errors or corrupt cached rows must never take down the
  // established primary-DB Strava summary map.
  const cached=await this.detail.withAccount(owner,async db=>{
   const row=await new ActivityRouteProjectionsRepository(db).get(id);
   if(!row||row.state!=='current')return null;
   if(row.provider==='strava'){
    // Rich payloads may have been explicitly refreshed without changing the
    // compact provider version. Metadata-only validation avoids serving the
    // old geometry if pre-replace invalidation failed or raced a refresh.
    if(!ref.strava||ref.strava.providerActivityId!==row.source_ref)return null;
    const resources=await new ActivityProviderResourcesRepository(db).metadata(ref.strava);
    const evidence=resources.find(r=>r.resourceType===row.resolution);
    if(!evidence||evidence.availability!=='available'
      ||evidence.providerVersion!==row.source_version
      ||evidence.fetchedAt.getTime()!==row.source_fetched_at.getTime())return null;
   }
   return row;
  }).catch(()=>null);
  if(cached?.state==='current'&&cached.algorithm_version===ROUTE_ALGORITHM_VERSION){
   const valid=cached.provider==='strava'
    ? ref.summary!.linked&&ref.strava?.providerActivityId===cached.source_ref&&ref.strava.providerVersion===cached.source_version
      &&summary.status==='available'
    : !ref.stravaLinked&&ref.garmin?.identity_key===cached.source_ref&&ref.garmin.current_hash===cached.source_version;
   if(valid) {
    const route=decodeStoredRoute(cached);
    if(route)return route;
   }
  }
  return summary;
 }
 async invalidateStrava(owner:string,id:string):Promise<void>{
  await this.detail.withAccount(owner,db=>new ActivityRouteProjectionsRepository(db).invalidate(id));
 }
 /** Explicit fetch/reprocess only. Each source is re-checked before auxiliary
  * publish, and the ordinary GET never reads these rich payloads. */
 async project(owner:string,id:string):Promise<{status:'projected'|'already_current'|'unavailable'|'stale';source?:string}>{
  const refs=await this.references(owner,id);
  if(refs.activityType==='swim'&&refs.activitySubtype==='indoor')return {status:'unavailable'};
  let route:ProjectedRoute|null=null, sourceRef='',sourceVersion='',fetchedAt=new Date();
  if(refs.stravaLinked){
   if(!refs.summary!.linked)return {status:'unavailable'};
   const ref=refs.strava;
   if(!ref)return {status:'unavailable'};
   const summary=stravaSummaryRoute(refs.summary!.polyline,refs.summary!.polylineType);
   if(summary.status!=='available')return {status:'unavailable'};
   const retained=await this.detail.withAccount(owner,db=>new ActivityProviderResourcesRepository(db).list(ref));
   const streams=retained.find(r=>r.resourceType==='streams'&&r.providerVersion===ref.providerVersion&&r.availability==='available');
   const detail=retained.find(r=>r.resourceType==='detail'&&r.providerVersion===ref.providerVersion&&r.availability==='available');
   if(!streams&&!detail)return {status:'unavailable'};
   route=projectStravaRoute(streams?.payload,detail?.payload,summary);
   sourceRef=ref.providerActivityId;sourceVersion=ref.providerVersion;
   fetchedAt=route?.resolution==='streams'?streams!.fetchedAt:detail?.fetchedAt??new Date();
  }else if(refs.garmin){
   const garmin=refs.garmin;
   const reference={identityKey:garmin.identity_key,sourceHash:garmin.current_hash};
   const messages=await this.detail.withAccount(owner,async db=>{
    const repo=new GarminActivityResourcesRepository(db);
    const [coverage,expected]=await Promise.all([repo.coverage(reference),repo.expectedResources(reference)]);
    if(!Array.isArray(expected)||expected.length<3||expected.length>100
      ||!expected.every(x=>x&&typeof x==='object'&&!Array.isArray(x)
         &&coverage.some(row=>row.resourceType===x.resourceType&&row.chunkIndex===x.chunkIndex)))return null;
    const records=coverage.filter(c=>c.resourceType==='records').sort((a,b)=>a.chunkIndex-b.chunkIndex);
    if(!records.length||records.length>100||records.some((r,i)=>r.chunkIndex!==i))return null;
    const result:Json[]=[];
    for(const record of records){
     // Read only GPS coordinates and timestamps; never materialize entire FIT telemetry chunks.
     const remaining=150001-result.length;
     const extracted=await sql<{message:Json}>`
       select jsonb_build_object('message',value->'message','fields',
         (select coalesce(jsonb_agg(field),'[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(value->'fields')='array'
            then value->'fields' else '[]'::jsonb end) as field
          where field->>'name' in ('position_lat','position_long','timestamp'))) as message
       from garmin_activity_resources r
       cross join lateral jsonb_array_elements(case when jsonb_typeof(r.payload_json)='array'
          then r.payload_json else '[]'::jsonb end) with ordinality as m(value,position)
       where r.identity_key=${reference.identityKey} and r.source_hash=${reference.sourceHash}
         and r.resource_type='records' and r.chunk_index=${record.chunkIndex}
         and value->>'message'='record'
       order by position limit ${remaining}
     `.execute(db);
     if(result.length+extracted.rows.length>150000)return null;
     result.push(...extracted.rows.map(row=>row.message));
    }
    return result;
   });
   if(!messages)return {status:'unavailable'};
   route=projectGarminRoute(messages);
   sourceRef=garmin.identity_key;sourceVersion=garmin.current_hash;
  }else return {status:'unavailable'};
  if(!route)return {status:'unavailable'};
  // Strava privacy policy: if there is a linked Strava summary, never fall
  // back to potentially unredacted Garmin FIT coordinates.
  const latest=await this.references(owner,id);
  if(route.provider==='strava' ? !latest.summary?.linked||!latest.strava||latest.strava.providerVersion!==sourceVersion
     ||latest.strava.providerActivityId!==sourceRef
   : latest.stravaLinked||latest.garmin?.identity_key!==sourceRef||latest.garmin?.current_hash!==sourceVersion)
    return {status:'stale'};
  const row=await this.detail.withAccount(owner,db=>new ActivityRouteProjectionsRepository(db).get(id));
  if(row?.state==='current'&&row.source_version===sourceVersion&&row.resource_hash===route.resourceHash
    &&row.resolution===route.resolution&&row.algorithm_version===ROUTE_ALGORITHM_VERSION)return {status:'already_current',source:route.resolution};
  const saved=await this.detail.withAccount(owner,db=>new ActivityRouteProjectionsRepository(db).publish({
   activity_id:id,provider:route.provider,resolution:route.resolution,source_ref:sourceRef,
   source_version:sourceVersion,resource_hash:route.resourceHash,
   algorithm_version:ROUTE_ALGORITHM_VERSION,polylines:route.polylines,bounds:route.bounds,
   point_count:route.pointCount,source_fetched_at:fetchedAt,
  }));
  return {status:saved?'projected':'stale',source:route.resolution};
 }
}
