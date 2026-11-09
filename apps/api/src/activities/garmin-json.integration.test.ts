import {ActivityTimelineService} from './activity-timeline.service.js';
import {createHash} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createDb,withAccountContext,GarminActivityResourcesRepository,ActivityMetricsRepository,RunningEffortsRepository,retainedLaps,type Database,type Kysely} from '@sportos/db';
import {GarminLocalIngestService,ActivityRouteProjectionService} from '@sportos/garmin-runtime';
const primaryUrl=process.env.SPORTOS_OWNER_TEST_DATABASE_URL,detailUrl=process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
const integration=primaryUrl&&detailUrl?describe:describe.skip;
integration('native JSON publication through non-owner primary/detail boundaries',()=>{
 let primary:ReturnType<typeof createDb>,detail:ReturnType<typeof createDb>,owner:string,foreign:string;
 const date='2001-02-03';
 const provider=(db:Kysely<Database>)=>({withAccount:<T>(owner:string,callback:(db:Kysely<Database>)=>Promise<T>)=>withAccountContext(db,owner,callback)});
 beforeAll(async()=>{
  for(const url of [primaryUrl!,detailUrl!])if(new URL(url).hostname!=='127.0.0.1')throw new Error('Disposable loopback database required');
  primary=createDb(primaryUrl!);detail=createDb(detailUrl!);
  owner=(await primary.insertInto('accounts').values({display_name:'Synthetic JSON owner',status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
  foreign=(await primary.insertInto('accounts').values({display_name:'Synthetic other owner',status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
 });
 afterAll(async()=>{await primary?.destroy();await detail?.destroy();});
 it('retains native resources before reconciliation, projects/reprocesses without FIT, isolates owners and preserves canonical/scoring facts',async()=>{
  const store={store:vi.fn(),read:vi.fn(),delete:vi.fn()};
  const retention=new GarminLocalIngestService(provider(primary),provider(detail),store as never,undefined,undefined,new ActivityRouteProjectionService(provider(primary),provider(detail)));
  for(const [index,sport,type,subtype] of [[0,'running','run','outdoor'],[1,'cycling','bike','outdoor'],[2,'strength_training','workout','indoor'],[3,'lap_swimming','swim','indoor']] as const){
   const start=`${date}T${String(8+index*3).padStart(2,'0')}:00:00Z`;
   const canonical=await withAccountContext(primary,owner,db=>db.insertInto('activities').values({source:'manual',activity_date:date,start_time:new Date(start),activity_type:type,subtype,duration_s:1200,moving_time_s:1200,distance_m:6000}).returningAll().executeTakeFirstOrThrow());
   const native=String(Date.now())+index;
   const sourceHash=createHash('sha256').update(native).digest('hex');
   const snapshot={providerActivityId:native,contentHash:sourceHash,origin:'connect',sourceUpdatedAt:'2026-11-01T00:00:00Z',summary:{activityType:type,subtype,startTime:start,elapsedTimeS:1200,movingTimeS:1200,distanceM:6000}};
   const ref={identityKey:`native:${native}`,sourceHash};
   const descriptors=[['directTimestamp','gmt'],['sumDuration','second'],['sumDistance','meter'],['directHeartRate','bpm'],['directLatitude','dd'],['directLongitude','dd']];
   const nativeDetail={metadataHash:'d'.repeat(64),metadata:{activityId:native,activityTypeDTO:{typeKey:sport},summaryDTO:{startTimeGMT:start,duration:1200,elapsedDuration:1200,movingDuration:1200,distance:6000,averageHR:140,...(type==='swim'?{poolLength:25,unitOfPoolLength:{unitKey:'meter'},numberOfActiveLengths:2}:{})}},
    details:{totalMetricsCount:601,metricDescriptors:descriptors.map(([key,unit],metricsIndex)=>({key,metricsIndex,unit:{key:unit}})),activityDetailMetrics:Array.from({length:601},(_,i)=>({metrics:[1000000000000+i*2000,i*2,i*10,140,50+i*.00001,10+i*.00001]}))},
    acquisition:{version:1,kind:'json',features:{summary:'available'},fallbackReasons:[],expectedResources:['detail','sets','laps'].map(resourceType=>({resourceType,chunkIndex:0}))}};
   const resources=[['detail',nativeDetail],['sets',{exerciseSets:[{setType:'ACTIVE'},{setType:'REST'}]}],['laps',{lapDTOs:[{duration:1200,elapsedDuration:1200,distance:6000,averageHR:140,...(type==='swim'?{lengthDTOs:[{lengthIndex:1,distance:25,duration:500,swimStroke:'FREESTYLE',totalNumberOfStrokes:15},{lengthIndex:2,duration:200},{lengthIndex:3,distance:25,duration:500,swimStroke:'FREESTYLE',totalNumberOfStrokes:15}]}:{})}]}]] as const;
   for(const [resourceType,payload] of resources.slice(0,2)){
    const bytes=Buffer.from(JSON.stringify({snapshot,resourceType,chunkIndex:0,payload}));await retention.retainResource({buffer:bytes,size:bytes.length},{id:owner});
   }
   await expect(retention.commit(snapshot,{id:owner})).rejects.toThrow('Retain original');
   const bytes=Buffer.from(JSON.stringify({snapshot,resourceType:'laps',chunkIndex:0,payload:resources[2][1]}));await retention.retainResource({buffer:bytes,size:bytes.length},{id:owner});
   const result=await retention.commit(snapshot,{id:owner});expect(result.activityId).toBe(canonical.id);
   expect(await retention.cachedBundle(ref.identityKey,sourceHash,{id:owner})).toBe(true);
   expect(await retention.cachedBundle(ref.identityKey,sourceHash,{id:owner},true)).toBe(false);
   expect(await retention.cachedBundle(ref.identityKey,sourceHash,{id:foreign})).toBe(false);
   await retention.commit(snapshot,{id:owner});
   const metrics=await withAccountContext(primary,owner,db=>new ActivityMetricsRepository(db).comparisons(canonical));
   expect(JSON.stringify(metrics)).toContain('garmin_summary');
   if(type==='run'){
    const efforts=await withAccountContext(primary,owner,db=>new RunningEffortsRepository(db).read(canonical.id));
    expect(efforts?.providers.find(p=>p.provider==='garmin')?.efforts[0]).toMatchObject({method:'json_calculated',status:'calculated',durationS:1000});
   }
   const timelines=new ActivityTimelineService(provider(primary) as never,provider(detail) as never);
   expect(await timelines.read(owner,canonical.id,'garmin')).toMatchObject({status:'available',sampleCount:601});
   if(type==='swim')expect(await timelines.swimLengths(owner,canonical.id)).toMatchObject({status:'available',sourceKind:'json',complete:true,effectiveDistanceM:6000,lengths:[{kind:'active'},{kind:'rest'},{kind:'active'}]});
   if(type==='run'||type==='bike')expect(await new ActivityRouteProjectionService(provider(primary),provider(detail)).read(owner,canonical.id)).toMatchObject({status:'available',resolution:'json'});
   if(type!=='workout'){
    const laps=await withAccountContext(detail,owner,db=>retainedLaps(db,canonical.id,null,{identity_key:ref.identityKey,current_hash:sourceHash},{limit:100,offset:0,provider:'garmin'}));
    expect(laps.items[0]).toMatchObject({distanceM:6000,timerS:1200});
   }
   expect(await withAccountContext(primary,owner,db=>db.selectFrom('activities').selectAll().where('id','=',canonical.id).executeTakeFirst())).toEqual(canonical);
   expect(await withAccountContext(detail,owner,db=>new GarminActivityResourcesRepository(db).coverage(ref))).toHaveLength(3);
  }
  expect(store.store).not.toHaveBeenCalled();expect(store.read).not.toHaveBeenCalled();
  expect(await withAccountContext(primary,owner,db=>db.selectFrom('score_ledger').selectAll().execute())).toEqual([]);
  expect(await withAccountContext(primary,owner,db=>db.selectFrom('daily_score_snapshots').selectAll().execute())).toEqual([]);
 });
});
