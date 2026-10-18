import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';
import { HistoricalRunsRepository } from './historical-runs.repository.js';
import { ActivitiesRepository } from './activities.repository.js';
const url=process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
(url?describe:describe.skip)('historical workbook reconstruction with non-owner RLS',()=>{
 let db:Kysely<Database>,owner:string,foreign:string;
 beforeAll(async()=>{db=createDb(url);expect((await sql`select current_user as role,rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0]).toEqual({role:'sportos_app',rolsuper:false,rolbypassrls:false});owner=(await db.insertInto('accounts').values({status:'active'}).returning('id').executeTakeFirstOrThrow()).id;foreign=(await db.insertInto('accounts').values({status:'active'}).returning('id').executeTakeFirstOrThrow()).id;});
 afterAll(async()=>{await db?.destroy();});
 const scoped=<T>(fn:(d:Kysely<Database>)=>Promise<T>,account=owner)=>withAccountContext(db,account,fn);
 async function source(d:Kysely<Database>,type:'my_sport_xlsx'|'run_db_xlsx'){
  const batch=await d.insertInto('import_batches').values({source:type,source_kind:'xlsx',status:'normalized'}).returning('id').executeTakeFirstOrThrow();
  return d.insertInto('source_records').values({source:type,import_batch_id:batch.id,row_hash:createHash('sha256').update(randomUUID()).digest('hex'),raw_json:{headers:['Date','Run'],cells:[0,10]}}).returning('id').executeTakeFirstOrThrow();
 }
 async function fixture(date:string,account=owner){return scoped(async d=>{
  const daily=await source(d,'my_sport_xlsx');await d.insertInto('daily_metrics').values({metric_date:date,source_record_id:daily.id,run_m:10000,steps:0,bike_m:0,swim_m:0,workout_points:0,base_points:0,bonus_points:0,total_points:3456,excel_all_points:3456,excel_row_hash:null}).execute();
  const ids=[];for(const distance of[5000,10000]){const s=await source(d,'run_db_xlsx');const e=await d.insertInto('performance_events').values({source:'run_db_xlsx',source_record_id:s.id,event_date:date,distance_m:distance,duration_s:distance*.3,pace_s_per_km:300,is_treadmill:true}).returning('id').executeTakeFirstOrThrow();ids.push(e.id);}return ids;
 },account);}
 const run=(date:string,apply=false,account=owner)=>scoped(d=>new HistoricalRunsRepository(d).run({from:date,to:date,limit:100,apply}),account);
 it('previews without writes, fills once, preserves ledger and creates audited many-to-one links',async()=>{
  const date='2074-01-01',ids=await fixture(date);const before=await scoped(d=>d.selectFrom('daily_metrics').selectAll().where('metric_date','=',date).execute());
  expect((await run(date)).plans[0].create).toMatchObject({distanceM:10000,durationS:3000});expect(await scoped(d=>d.selectFrom('activities').select('id').where('activity_date','=',date).execute())).toHaveLength(0);
  expect(await run(date,true)).toMatchObject({created:1,linked:2});expect(await run(date,true)).toMatchObject({created:0,linked:0});
  const activities=await scoped(d=>d.selectFrom('activities').selectAll().where('activity_date','=',date).execute());expect(activities).toHaveLength(1);expect(activities[0]).toMatchObject({start_time:null,moving_time_s:null,duration_s:3000,distance_m:'10000.00',subtype:'treadmill'});
  expect(await scoped(d=>d.selectFrom('daily_metrics').selectAll().where('metric_date','=',date).execute())).toEqual(before);
  expect(await scoped(d=>d.selectFrom('performance_match_decisions').select(['activity_id','method']).where('event_id','in',ids).execute())).toEqual([{activity_id:activities[0].id,method:'historical'},{activity_id:activities[0].id,method:'historical'}]);
  expect(await scoped(d=>new ActivitiesRepository(d).get(activities[0].id))).toMatchObject({historicalSummary:true,providerDetail:null});
  expect(await scoped(d=>new ActivitiesRepository(d).get(activities[0].id),foreign)).toBeNull();
 });
 it('respects existing provider/manual history and isolates same-date work by owner',async()=>{
  const date='2074-02-01';await fixture(date);await fixture(date,foreign);
  await scoped(d=>d.insertInto('activities').values({source:'manual',activity_type:'run',activity_date:date,distance_m:10000}).execute());
  expect(await run(date,true)).toMatchObject({created:0,linked:0});expect(await run(date,true,foreign)).toMatchObject({created:1,linked:2});
 });
 it('serializes concurrent replay under the shared account lock',async()=>{const date='2074-04-01';await fixture(date);const outcomes=await Promise.all([run(date,true),run(date,true)]);expect(outcomes.map(r=>r.created).sort()).toEqual([0,1]);expect(outcomes.map(r=>r.linked).sort()).toEqual([0,2]);});
 it('enforces historical provenance/foreign-owner constraints without weakening normal Strava matching',async()=>{
  const date='2074-03-01',ids=await fixture(date);await run(date,true);
  const own=(await scoped(d=>d.selectFrom('activities').select('id').where('activity_date','=',date).executeTakeFirstOrThrow())).id;
  const other=(await scoped(d=>d.insertInto('activities').values({source:'manual',activity_type:'run',activity_date:date,distance_m:10000}).returning('id').executeTakeFirstOrThrow(),foreign)).id;
  const decision=(activityId:string,method:'historical'|'operator')=>scoped(d=>d.insertInto('performance_match_decisions').values({event_id:ids[0],activity_id:activityId,status:'accepted',method,policy_version:1,input_hash:'a'.repeat(64),reason:'historical_excel_reconstruction',diagnostics:[]}).execute());
  await expect(decision(other,'historical')).rejects.toThrow();await expect(decision(own,'operator')).rejects.toThrow('Running provider identity unavailable');
  await expect(scoped(d=>d.updateTable('performance_match_decisions').set({reason:'changed'}).where('event_id','=',ids[0]).execute())).rejects.toThrow();
 });
});
