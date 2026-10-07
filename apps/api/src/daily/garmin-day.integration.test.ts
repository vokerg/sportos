import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb, sql, GarminDayRepository, GarminActivityResourcesRepository, withAccountContext, type Database, type Kysely, type Json } from '@sportos/db';
import { GarminDayService } from './garmin-day.service.js';
import { GarminLocalIngestService } from '../activities/garmin-local-ingest.service.js';
const primaryUrl=process.env.SPORTOS_OWNER_TEST_DATABASE_URL,detailUrl=process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
const integration=primaryUrl && detailUrl ? describe : describe.skip;
integration('one-day evidence through real non-owner retention and reconciliation',()=>{
  let db:ReturnType<typeof createDb>,detailDb:ReturnType<typeof createDb>,owner:string;
  const date='2026-03-29', native=String(Date.now()), originals=new Map<string,Buffer>();
  const summaries=[
    {activityType:'run',subtype:'outdoor',startTime:`${date}T08:00:00Z`,elapsedTimeS:1800,movingTimeS:1750,distanceM:5000},
    {activityType:'run',subtype:'outdoor',startTime:`${date}T10:00:00Z`,elapsedTimeS:1800,movingTimeS:1750,distanceM:5000},
    {activityType:'run',subtype:'outdoor',startTime:`${date}T12:00:00Z`,elapsedTimeS:1800,movingTimeS:1750,distanceM:5000},
    {activityType:'workout',subtype:'indoor',startTime:`${date}T16:00:00Z`,elapsedTimeS:1800,movingTimeS:1750,distanceM:null},
  ];
  beforeAll(async()=>{
    for(const url of [primaryUrl!,detailUrl!])if(new URL(url).hostname!=='127.0.0.1')throw new Error('Disposable loopback databases required.');
    db=createDb(primaryUrl!);detailDb=createDb(detailUrl!);
    owner=(await db.insertInto('accounts').values({display_name:'Synthetic day pipeline',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    await withAccountContext(db,owner,async ctx=>{
      for(const index of [0,1,1,3]) {const s=summaries[index]!;await ctx.insertInto('activities').values({source:'manual',activity_date:date,start_time:new Date(s.startTime),activity_type:s.activityType as 'run',subtype:s.subtype as 'outdoor',duration_s:s.elapsedTimeS,moving_time_s:s.movingTimeS,distance_m:index===0?5200:s.distanceM}).execute();}
      await ctx.insertInto('daily_metrics').values({metric_date:date,steps:1234,run_m:0,bike_m:0,swim_m:0,workout_points:0,base_points:9876,bonus_points:0,total_points:9876,score_status:'manual'}).execute();
      await ctx.insertInto('score_ledger').values({metric_date:date,activity_id:null,rule_id:null,points:9876,reason:'Synthetic imported history',calculation_json:{}}).execute();
      await ctx.insertInto('daily_score_snapshots').values({metric_date:date,score_status:'manual',base_points:9876,bonus_points:0,total_points:9876,facts_json:{steps:1234},ledger_json:sql<Json>`'[]'::jsonb`,source_record_id:null,trigger:'manual_edit'}).execute();
    });
  });
  afterAll(async()=>{vi.restoreAllMocks();await db?.destroy();await detailDb?.destroy();});
  it('retains all day categories and sets, matches unique activities, stages ambiguous/Garmin-only, converges cache and keeps official rows unchanged',async()=>{
    const provider=(database:Kysely<Database>)=>({withAccount:<T>(id:string,callback:(ctx:Kysely<Database>)=>Promise<T>)=>withAccountContext(database,id,callback)});
    const primary=provider(db),detail=provider(detailDb);
    const storage={store:vi.fn(async input=>{const key=`${input.sha256.slice(0,2)}/${input.uploadId}.fit`;originals.set(key,input.bytes);return {provider:'local',objectKey:key};}),read:vi.fn(async key=>{if(!originals.has(key))throw new Error('missing');return originals.get(key)!;}),delete:vi.fn(async key=>{originals.delete(key);})};
    const retention=new GarminLocalIngestService(primary as never,detail as never,storage as never);
    const payloads:Record<string,Json>={summary:{calendarDate:date,totalSteps:12345,totalDistanceMeters:8000,totalKilocalories:2400},weight:{dateWeightList:[{calendarDate:date,timestampGMT:1774774800000,weight:70000},{calendarDate:date,timestampGMT:1774803600000,weight:70500}]},sleep:{dailySleepDTO:{calendarDate:date,sleepTimeSeconds:28800}},heart_rate:{restingHeartRate:55},hrv:{hrvSummary:{calendarDate:date,lastNightAvg:60}},stress:{avgStressLevel:20},body_battery:[{date,charged:70,drained:30}],activities:{items:summaries.map((s,index)=>({activityId:native+index,startTimeLocal:s.startTime.slice(0,19)})),complete:true}};

    const bridge=vi.fn(async request=>request.operation==='day'?{schema:'sportos.garmin-day.v1',date,categories:request.categories.map((category:string)=>({category,state:'available',sourceHash:createHash('sha256').update(JSON.stringify(payloads[category])).digest('hex'),byteSize:100}))}:{bundle:{snapshot:{providerActivityId:request.providerActivityId}}});
    const enrichment={localEnabled:()=>true,bridge};
    const service=new GarminDayService(primary as never,detail as never,storage as never,enrichment as never);
    vi.spyOn(service,'localPayload').mockImplementation(async entry=>payloads[entry.category]!);
    vi.spyOn(GarminLocalIngestService.prototype,'retainBundle').mockImplementation(async input=>{
      const index=summaries.findIndex((_,i)=>native+i===input.bundle.snapshot.providerActivityId);
      const snapshot={providerActivityId:native+index,contentHash:createHash('sha256').update(native+index).digest('hex'),origin:'connect',sourceUpdatedAt:'2026-03-30T10:00:00Z',summary:summaries[index]};
      const resources=[{resourceType:'detail',chunkIndex:0},{resourceType:'sets',chunkIndex:0},{resourceType:'records',chunkIndex:0}];
      const payloads=[{metadataHash:'d'.repeat(64),metadata:{activityId:native+index},details:{}},{exerciseSets:[{repetitions:10,weight:20000,weightUnit:'grams'}]},[{message:'session',fields:[]}]];
      for(let i=0;i<3;i++){const bytes=Buffer.from(JSON.stringify({snapshot,...resources[i],payload:payloads[i]}));await retention.retainResource({buffer:bytes,size:bytes.length},{id:owner,displayName:'Synthetic',email:null});}
      const bytes=Buffer.alloc(14);bytes.write('.FIT',8);await retention.retainOriginal({buffer:bytes,size:bytes.length},{snapshot:JSON.stringify(snapshot),resources:JSON.stringify(resources)},{id:owner,displayName:'Synthetic',email:null});
      return retention.commit(snapshot,{id:owner,displayName:'Synthetic',email:null});
    });
    const official=()=>withAccountContext(db,owner,async ctx=>({activities:await ctx.selectFrom('activities').selectAll().orderBy('id').execute(),scores:await ctx.selectFrom('daily_metrics').selectAll().execute(),ledger:await ctx.selectFrom('score_ledger').selectAll().execute(),snapshots:await ctx.selectFrom('daily_score_snapshots').selectAll().execute()}));
    const before=await official();const account={id:owner,displayName:'Synthetic',email:null};
    const first=await service.fetch(account,date,false);
    expect(first.state).toBe('current');expect(first.categories.find(c=>c.category==='weight')?.evidence).toMatchObject({measurements:[{weightKg:70},{weightKg:70.5}]});
    expect(first.categories.find(c=>c.category==='activities')?.evidence).toMatchObject({count:4,activities:[{reconciliation:'strong_unique'},{reconciliation:'ambiguous',activityId:null},{reconciliation:'unmatched',activityId:null},{reconciliation:'exact'}]});
    expect(await withAccountContext(detailDb,owner,ctx=>new GarminActivityResourcesRepository(ctx).read({identityKey:'native:'+native+3,sourceHash:createHash('sha256').update(native+3).digest('hex')},'sets'))).toMatchObject({payload:{exerciseSets:[{repetitions:10}]}});
    const calls=bridge.mock.calls.length;expect((await service.fetch(account,date,false)).result).toBe('cached');expect(bridge.mock.calls).toHaveLength(calls);
    expect(await official()).toEqual(before);
    const foreign=(await db.insertInto('accounts').values({display_name:'Synthetic other',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    expect((await service.read(foreign,date)).state).toBe('missing');await expect(service.resource(foreign,date,'summary')).rejects.toMatchObject({status:404});
    const publicJson=JSON.stringify(await service.read(owner,date));for(const key of ['identityKey','sourceHash','source_hash','owner_id','metadataHash','objectKey','password'])expect(publicJson).not.toContain(key);
    // Refresh changed daily content adds exactly one version per category; old history stays.
    payloads.summary={calendarDate:date,totalSteps:12346};await service.fetch(account,date,true);await service.fetch(account,date,true);
    expect(await withAccountContext(db,owner,ctx=>ctx.selectFrom('garmin_day_versions').selectAll().execute())).toHaveLength(9);
    expect(await official()).toEqual(before);
    expect((await withAccountContext(db,owner,ctx=>new GarminDayRepository(ctx).read(date))).find(c=>c.category==='summary')?.projection_json).toMatchObject({steps:12346});
  });
});
