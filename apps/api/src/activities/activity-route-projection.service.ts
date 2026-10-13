import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityProviderResourcesRepository, ActivityRouteProjectionsRepository,
 ActivitiesRepository, GarminActivityResourcesRepository, type Json } from '@sportos/db';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { stravaSummaryRoute, type ActivityRouteResponse } from './activity-route.js';
import { decodeStoredRoute, projectGarminRoute, projectStravaRoute,
 ROUTE_ALGORITHM_VERSION, type ProjectedRoute } from './activity-route-projection.js';
type RouteRefs = {
 summary: Awaited<ReturnType<ActivitiesRepository['getStravaRouteEvidence']>>;
 strava: Awaited<ReturnType<ActivityProviderResourcesRepository['getProviderReference']>>;
 garmin: {identity_key:string;current_hash:string}|undefined;
};
/** No provider/credential imports; all reprocessing uses retained resources. */
@Injectable()
export class ActivityRouteProjectionService {
 constructor(private readonly primary:DbProvider,private readonly detail:ActivityDetailDbProvider){}
 private async references(owner:string,id:string):Promise<RouteRefs> {
  return this.primary.withAccount(owner,async db=>{
   const summary=await new ActivitiesRepository(db).getStravaRouteEvidence(id);
   if(!summary)throw new NotFoundException({code:'ACTIVITY_NOT_FOUND',message:'Activity was not found.'});
   const strava=summary.linked?await new ActivityProviderResourcesRepository(db).getProviderReference(id):null;
   const garmin=await db.selectFrom('garmin_activity_identities')
    .select(['identity_key','current_hash']).where('activity_id','=',id).executeTakeFirst();
   return {summary,strava,garmin};
  });
 }
 async read(owner:string,id:string):Promise<ActivityRouteResponse> {
  const ref=await this.references(owner,id);
  const summary=ref.summary!.linked?stravaSummaryRoute(ref.summary!.polyline,ref.summary!.polylineType)
    :{status:'unavailable' as const,reason:'no_gps' as const};
  const cached=await this.detail.withAccount(owner,db=>new ActivityRouteProjectionsRepository(db).get(id));
  if(cached?.state==='current'&&cached.algorithm_version===ROUTE_ALGORITHM_VERSION){
   const valid=cached.provider==='strava'
    ? ref.summary!.linked&&ref.strava?.providerActivityId===cached.source_ref&&ref.strava.providerVersion===cached.source_version
      &&summary.status==='available'
    : !ref.summary!.linked&&ref.garmin?.identity_key===cached.source_ref&&ref.garmin.current_hash===cached.source_version;
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
  let route:ProjectedRoute|null=null, sourceRef='',sourceVersion='',fetchedAt=new Date();
  if(refs.summary!.linked){
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
     const resource=await repo.read(reference,'records',record.chunkIndex);
     if(!resource||!Array.isArray(resource.payload)||result.length+resource.payload.length>150000)return null;
     result.push(...resource.payload);
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
   : latest.summary?.linked||latest.garmin?.identity_key!==sourceRef||latest.garmin?.current_hash!==sourceVersion)
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
