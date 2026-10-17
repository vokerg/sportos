import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import type { Database, Json } from '../schema.js';
import { PerformanceMatchesRepository } from './performance-matches.repository.js';
import { DistanceLeaderboardRepository } from './distance-leaderboard.repository.js';
import { PerformanceRepository } from './performance.repository.js';
import { RetainedRunningEffortProjector } from '../running-effort-projector.js';
import {previewPerformanceCatchup} from '../performance-catchup.js';
import {vi} from 'vitest';
import { ActivityProviderResourcesRepository } from './activity-provider-resources.repository.js';
const enabled=process.env.SPORTOS_OWNER_TEST_DATABASE_URL && process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
(enabled?describe:describe.skip)('distance leaderboard non-owner integration',()=>{
 let db:Kysely<Database>,detail:Kysely<Database>,owner:string,foreign:string;
 const scoped=<T>(fn:(d:Kysely<Database>)=>Promise<T>,account=owner)=>withAccountContext(db,account,fn);
 beforeAll(async()=>{
  db=createDb(process.env.SPORTOS_OWNER_TEST_DATABASE_URL);detail=createDb(process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL);
  expect((await sql`select current_user as role,rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0]).toEqual({role:'sportos_app',rolsuper:false,rolbypassrls:false});
  owner=(await db.insertInto('accounts').values({status:'active',display_name:'Synthetic leaderboard',email:null}).returning('id').executeTakeFirstOrThrow()).id;
  foreign=(await db.insertInto('accounts').values({status:'active',display_name:'Synthetic leaderboard',email:null}).returning('id').executeTakeFirstOrThrow()).id;
 });
 afterAll(async()=>{await db?.destroy();await detail?.destroy();});
 async function fixture(activityDate='2026-05-01'){return scoped(async d=>{
  const native=randomUUID(),hash=createHash('sha256').update(native).digest('hex');
  const c=await d.insertInto('provider_connections').values({provider:'strava',provider_account_id:native,display_name:null,scopes:[],status:'connected',access_expires_at:null,cursor_json:{}}).onConflict(oc=>oc.columns(['owner_id','provider']).doUpdateSet({status:'connected'})).returning('id').executeTakeFirstOrThrow();
  const batch=await d.insertInto('import_batches').values({source:'strava_api',source_kind:'strava',filename:null,original_sha256:null,status:'normalized',completed_at:null,metadata:{}}).returning('id').executeTakeFirstOrThrow();
  const source=await d.insertInto('source_records').values({import_batch_id:batch.id,source:'strava_api',sheet_name:null,row_index:null,source_record_key:native,row_hash:hash,raw_json:{distance:10040,moving_time:2410},normalized_entity_type:null,normalized_entity_id:null,status:'raw',errors:[],warnings:[]}).returning('id').executeTakeFirstOrThrow();
  const a=await d.insertInto('activities').values({source:'strava',source_record_id:source.id,source_activity_id:native,activity_type:'run',activity_date:activityDate,subtype:'outdoor',distance_m:10040,moving_time_s:2410,duration_s:2500}).returning('id').executeTakeFirstOrThrow();
  const link=await d.insertInto('provider_activity_links').values({connection_id:c.id,provider_activity_id:native,activity_id:a.id,latest_source_record_id:source.id,identity_fingerprint:hash,fingerprint_version:1,availability:'available',provider_updated_at:null}).returning('id').executeTakeFirstOrThrow();
  const events=[];for(const distance of [5000,10000,12000,21100,42195]){
   const row={source:'run_db_xlsx' as const,activity_id:null,source_record_id:null,source_record_hash:createHash('sha256').update(`${native}-${distance}`).digest('hex'),event_date:'2026-05-01',distance_m:distance,duration_s:Math.round(distance*.24),pace_s_per_km:240,is_treadmill:false,is_race:false,is_pr_marker:false,source_rank:99,tags:[],notes:null,raw_payload_json:{}};
   const event=(await new PerformanceRepository(d).insertPerformanceEvents([row]))[0];events.push({row,event});
  }
  return {activity:a.id,native,hash,connection:c.id,link:link.id,source:source.id,batch:batch.id,events};
 });}
 const board=(distanceM=5000,account=owner)=>scoped(d=>new DistanceLeaderboardRepository(d).read({distanceM,limit:100}),account);
 it('matches summary-only many-to-one, preserves re-imports, prefers Excel and hides stale measured alternatives',async()=>{
  const f=await fixture();
  for(const e of f.events.slice(0,2)){
   expect((await scoped(d=>new PerformanceMatchesRepository(d).reconcile(e.event.id)))?.result.activityId).toBe(f.activity);
   expect(await scoped(d=>d.selectFrom('performance_match_heads').selectAll().where('event_id','=',e.event.id).execute())).toHaveLength(0);
   await scoped(d=>new PerformanceMatchesRepository(d).reconcile(e.event.id,false));
  }
  expect((await board()).rows).toHaveLength(1);expect((await board()).rows[0]).toMatchObject({source:'excel',durationS:1200,activityId:f.activity,rank:1});
  expect((await board(21097.5)).rows[0].durationS).toBe(5064);expect((await board(42195)).rows).toHaveLength(1);
  await expect(board(12000)).rejects.toThrow('Unsupported');
  const old=await scoped(d=>d.selectFrom('performance_match_decisions').selectAll().execute());
  for(const e of f.events.slice(0,2)){await scoped(d=>new PerformanceRepository(d).insertPerformanceEvents([e.row]));await scoped(d=>new PerformanceMatchesRepository(d).reconcile(e.event.id,false));}
  expect(await scoped(d=>d.selectFrom('performance_match_decisions').selectAll().execute())).toEqual(old);
  const project=()=>scoped(d=>new RetainedRunningEffortProjector(d,fn=>withAccountContext(detail,owner,fn)).project(f.activity,false,'strava'));
  await project(); expect((await board()).rows[0].alternatives).toHaveLength(0); // estimates never rank
  const distances=Array.from({length:1005},(_,i)=>i*10);
  await withAccountContext(detail,owner,d=>new ActivityProviderResourcesRepository(d).replace({activityId:f.activity,provider:'strava',providerActivityId:f.native,connectionId:f.connection,providerVersion:f.hash},[{resourceType:'streams',availability:'available',httpStatus:200,payload:{time:{data:distances.map(d=>d*.25)},distance:{data:distances},moving:{data:distances.map(()=>true)}} as Json}]));
  await project();const result=await board();expect(result.rows).toHaveLength(1);expect(result.rows[0].durationS).toBe(1200);expect(result.rows[0].alternatives).toMatchObject([{source:'strava',durationS:1250}]);
  const head=await scoped(d=>d.selectFrom('running_effort_heads').selectAll().where('activity_id','=',f.activity).where('provider','=','strava').executeTakeFirstOrThrow());
  const oldAlgorithm=await scoped(d=>d.insertInto('running_effort_projections').values({activity_id:f.activity,provider:'strava',source_ref:f.link,source_version:f.hash,input_hash:'a'.repeat(64),resource_hash:null,algorithm_version:4}).returning('id').executeTakeFirstOrThrow());
  await scoped(d=>d.updateTable('running_effort_heads').set({projection_id:oldAlgorithm.id}).where('activity_id','=',f.activity).where('provider','=','strava').execute());
  expect((await board()).rows[0].alternatives).toHaveLength(0);
  await scoped(d=>d.updateTable('running_effort_heads').set({projection_id:head.projection_id,expected_resource_hash:'b'.repeat(32)}).where('activity_id','=',f.activity).where('provider','=','strava').execute());
  expect((await board()).rows[0].alternatives).toHaveLength(0);
  await scoped(d=>d.updateTable('running_effort_heads').set({expected_resource_hash:null}).where('activity_id','=',f.activity).where('provider','=','strava').execute());
  expect((await board()).rows[0].alternatives).toHaveLength(1);
  const changedSource=await scoped(d=>d.insertInto('source_records').values({import_batch_id:f.batch,source:'strava_api',sheet_name:null,row_index:null,source_record_key:f.native,row_hash:'c'.repeat(64),raw_json:{distance:10040,moving_time:2420},normalized_entity_type:null,normalized_entity_id:null,status:'raw',errors:[],warnings:[]}).returning('id').executeTakeFirstOrThrow());
  await scoped(d=>d.updateTable('provider_activity_links').set({latest_source_record_id:changedSource.id}).where('id','=',f.link).execute());
  expect((await board()).rows[0].alternatives).toHaveLength(0);
  await scoped(d=>d.updateTable('running_effort_heads').set({state:'failed',failure_category:'projection_failed'}).where('activity_id','=',f.activity).execute());
  expect((await board()).rows[0].alternatives).toHaveLength(0);
  expect((await board(5000,foreign)).rows).toHaveLength(0);
  expect(await scoped(d=>new PerformanceMatchesRepository(d).inspect(f.events[0].event.id),foreign)).toBeNull();
  await expect(scoped(d=>d.updateTable('performance_match_decisions').set({reason:'changed'}).execute())).rejects.toThrow();
  await expect(scoped(d=>d.insertInto('performance_match_heads').values({event_id:f.events[0].event.id,decision_id:old[0].id}).execute(),foreign)).rejects.toThrow();
 });
 it('explicit rejection survives replay and operator confirmation is audited',async()=>{
  const f=await fixture(),id=f.events[0].event.id;
  await scoped(d=>new PerformanceMatchesRepository(d).reconcile(id,false,{activityId:null}));
  await scoped(d=>new PerformanceMatchesRepository(d).reconcile(id,false));
  expect((await board()).rows.find(r=>r.eventId===id)?.activityId).toBeNull();
  await scoped(d=>new PerformanceMatchesRepository(d).reconcile(id,false,{activityId:f.activity}));
  expect((await board()).rows.find(r=>r.eventId===id)?.activityId).toBe(f.activity);
  const decisions=await scoped(d=>d.selectFrom('performance_match_decisions').selectAll().where('event_id','=',id).execute());expect(decisions).toHaveLength(2);
  await expect(scoped(d=>new PerformanceMatchesRepository(d).reconcile(id,false,{activityId:randomUUID()}))).rejects.toThrow();
 });
 it('previews per-distance cutoffs, unions targets, reuses retained streams and rejects stale source versions without requests',async()=>{
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Provider requests forbidden'));
  try{
   const f=await fixture('2026-06-01');
   const preview=(account=owner,cursor?:string)=>scoped(d=>previewPerformanceCatchup(d,fn=>withAccountContext(detail,account,fn),{dryRun:true,limit:25,through:'2026-10-17',cursor}),account);
   expect((await preview(foreign)).blocked).toBe('no_excel_cutoffs');
   const first=await preview();expect(first.rows).toEqual([{activityId:f.activity,targets:[5000,10000],category:'needs_rich_fetch',action:'fetch'}]);
   const distances=Array.from({length:1005},(_,i)=>i*10);
   await withAccountContext(detail,owner,d=>new ActivityProviderResourcesRepository(d).replace({activityId:f.activity,provider:'strava',providerActivityId:f.native,connectionId:f.connection,providerVersion:f.hash},[{resourceType:'streams',availability:'available',httpStatus:200,payload:{time:{data:distances.map(d=>d*.25)},distance:{data:distances},moving:{data:distances.map(()=>true)}} as Json}]));
   expect((await preview()).rows[0]).toMatchObject({category:'retained_unprocessed',action:'reprocess'});
   await scoped(d=>new RetainedRunningEffortProjector(d,fn=>withAccountContext(detail,owner,fn)).project(f.activity,false,'strava'));
   expect((await preview()).rows[0]).toMatchObject({category:'already_current',action:'skip'});
   expect((await preview(owner,first.nextCursor!)).rows).toHaveLength(0);
   const history=await scoped(d=>d.selectFrom('running_effort_projections').selectAll().where('activity_id','=',f.activity).execute());
   await scoped(d=>d.updateTable('running_effort_projections').set({algorithm_version:4}).where('activity_id','=',f.activity).execute()).then(()=>{throw new Error('History should be immutable');},()=>undefined);
   await scoped(d=>d.updateTable('running_effort_heads').set({state:'stale'}).where('activity_id','=',f.activity).execute());
   expect((await preview()).rows[0]).toMatchObject({category:'retained_stale',action:'reprocess'});
   expect(await scoped(d=>d.selectFrom('running_effort_projections').selectAll().where('activity_id','=',f.activity).execute())).toEqual(history);
   expect(network).not.toHaveBeenCalled();
  }finally{network.mockRestore();}
 });
 it('preserves an existing historical activity pointer on workbook re-import',async()=>{
  const f=await fixture(),item=f.events[0];
  await scoped(d=>d.updateTable('performance_events').set({activity_id:f.activity}).where('id','=',item.event.id).execute());
  const [replayed]=await scoped(d=>new PerformanceRepository(d).insertPerformanceEvents([item.row]));
  expect(replayed.id).toBe(item.event.id);expect(replayed.activity_id).toBe(f.activity);expect(replayed.duration_s).toBe(item.row.duration_s);
 });
 it('bounds alternatives and keeps unlinked event IDs distinct from activity IDs',async()=>{
  const f=await fixture(),item=f.events[0];
  await scoped(d=>d.updateTable('performance_events').set({activity_id:f.activity}).where('id','=',item.event.id).execute());
  const more=Array.from({length:22},(_,i)=>({...item.row,activity_id:f.activity,duration_s:1300+i,source_record_hash:createHash('sha256').update(`${f.native}-alternative-${i}`).digest('hex')}));
  await scoped(d=>new PerformanceRepository(d).insertPerformanceEvents(more));
  await scoped(d=>new PerformanceRepository(d).insertPerformanceEvents([{...item.row,id:f.activity,duration_s:1400,source_record_hash:createHash('sha256').update(`${f.native}-unlinked`).digest('hex')}]));
  const result=await board(),ranked=result.rows.find(r=>r.activityId===f.activity)!;
  expect(ranked.alternativeCount).toBe(22);expect(ranked.alternatives).toHaveLength(20);
  expect(result.rows.find(r=>r.eventId===f.activity)).toMatchObject({activityId:null,durationS:1400});
 });
 it('dispatcher cannot access match heads, audit or leaderboard inputs',async()=>{
  if(!process.env.SPORTOS_WORKER_TEST_DATABASE_URL)return;
  const dispatcher=createDb(process.env.SPORTOS_WORKER_TEST_DATABASE_URL);
  try{for(const table of ['performance_match_heads','performance_match_decisions','running_effort_values'] as const)await expect(dispatcher.selectFrom(table).selectAll().execute()).rejects.toThrow();}finally{await dispatcher.destroy();}
 });
});
