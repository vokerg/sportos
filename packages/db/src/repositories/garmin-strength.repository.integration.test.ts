import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeGarminStrength } from '@sportos/domain';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { GarminActivitiesRepository } from './garmin-activities.repository.js';
import { GarminStrengthRepository } from './garmin-strength.repository.js';
import { GarminDayRepository } from './garmin-day.repository.js';
import { DailyScoringRepository } from './daily-scoring.repository.js';
import { sql } from 'kysely';
const url=process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration=url?describe:describe.skip;
integration('retained strength scoring, source history and account isolation',()=>{
  let db:ReturnType<typeof createDb>,owner:string,foreign:string,activityId:string;
  const date='2026-03-28';
  const snapshot={provider:'garmin' as const,providerActivityId:String(Date.now()),contentHash:'a'.repeat(64),origin:'connect' as const,
    sourceUpdatedAt:new Date('2026-03-29T10:00:00Z'),summary:{activityType:'workout' as const,subtype:'indoor' as const,startTime:new Date(`${date}T10:00:00Z`),elapsedTimeS:1800,movingTimeS:1750,distanceM:null}};
  const strength=(sets:number)=>normalizeGarminStrength([{exerciseSets:Array.from({length:sets},()=>({setType:'ACTIVE',exerciseName:'Synthetic exercise'}))}]);
  const account=<T>(fn:Parameters<typeof withAccountContext<T>>[2])=>withAccountContext(db,owner,fn);
  beforeAll(async()=>{
    if(new URL(url!).hostname!=='127.0.0.1')throw new Error('Disposable loopback database required.');
    db=createDb(url!);
    const role=await sql<{rolsuper:boolean;rolbypassrls:boolean}>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db);
    expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
    owner=(await db.insertInto('accounts').values({display_name:'Synthetic strength',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    foreign=(await db.insertInto('accounts').values({display_name:'Synthetic foreign',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    await account(async tx=>{await sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(tx);});
  });
  afterAll(async()=>{await db?.destroy();});
  it('converges source replay, exposes a later link and changes no canonical facts on enrichment',async()=>{
    const first=await account(tx=>new GarminActivitiesRepository(tx).ingest(snapshot,strength(6)));
    expect(first.activityId).toBeNull();
    const second=await account(tx=>new GarminActivitiesRepository(tx).ingest(snapshot,strength(6)));
    expect(second.versionAdded).toBe(false);
    expect(await account(tx=>tx.selectFrom('garmin_strength_summaries').selectAll().execute())).toHaveLength(1);
    activityId=await account(async tx=>(await tx.insertInto('activities').values({source:'strava',source_activity_id:randomUUID(),activity_date:date,start_time:snapshot.summary.startTime,activity_type:'workout',subtype:'indoor',duration_s:1800,moving_time_s:1750}).returning('id').executeTakeFirstOrThrow()).id);
    const before=await account(tx=>tx.selectFrom('activities').selectAll().execute());
    await account(tx=>new GarminActivitiesRepository(tx).ingest(snapshot,strength(6)));
    expect(await account(tx=>new GarminStrengthRepository(tx).forActivity(activityId))).toMatchObject({workingSets:6,complete:true});
    expect(await account(tx=>tx.selectFrom('activities').selectAll().execute())).toEqual(before);
    await expect(account(tx=>new GarminActivitiesRepository(tx).ingest(snapshot,strength(9)))).rejects.toThrow('Conflicting');
  });
  it('replaces imported steps/workout only on recalc and appends history with primary-only evidence',async()=>{
    await account(async tx=>{
      const source={category:'summary' as const,state:'available' as const,attemptedAt:new Date(),version:{hash:'c'.repeat(64),availability:'available' as const,projection:{steps:12345}}};
      await new GarminDayRepository(tx).publish(date,source);
      await new GarminDayRepository(tx).publish(date,{category:'activities',state:'available',attemptedAt:new Date(),version:{hash:'d'.repeat(64),availability:'available',projection:{identities:[`native:${snapshot.providerActivityId}`],complete:true}}});
      await tx.insertInto('daily_metrics').values({metric_date:date,steps:8000,run_m:0,bike_m:0,swim_m:0,workout_points:9000,base_points:10000,bonus_points:0,total_points:10000,excel_all_points:10000,score_status:'imported'}).execute();
      await tx.insertInto('daily_score_snapshots').values({metric_date:date,score_status:'imported',base_points:10000,bonus_points:0,total_points:10000,facts_json:{steps:8000,workoutPoints:9000},ledger_json:sql`'[]'::jsonb`,trigger:'workbook_import'}).execute();
    });
    const result=await account(tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(result.facts).toMatchObject({steps:12345,workoutPoints:2000,stepsCalculation:{garminSource:'connect'},workoutCalculation:{source:'garmin_sets',workingSets:6}});
    expect(result.ledger.find(row=>row.rule?.code==='workout.points')?.calculation).toMatchObject({workoutCalculation:{workingSets:6,policyVersion:1,resolvedPoints:2000}});
    expect(await account(tx=>tx.selectFrom('daily_score_snapshots').selectAll().where('metric_date','=',date).execute())).toHaveLength(2);
    await account(tx=>new GarminDayRepository(tx).publish(date,{category:'summary',state:'failed',attemptedAt:new Date()}));
    const failed=await account(tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(failed.facts.stepsCalculation).toMatchObject({garminSource:'connect',latestAttemptState:'failed',garminTotalSteps:12345});
  });
  it('selects newer summary while preserving old versions, falls back for partial evidence',async()=>{
    await account(tx=>new GarminActivitiesRepository(tx).ingest({...snapshot,contentHash:'b'.repeat(64),sourceUpdatedAt:new Date('2026-03-30T10:00:00Z')},strength(3)));
    expect(await account(tx=>new GarminStrengthRepository(tx).forActivity(activityId))).toMatchObject({workingSets:3});
    expect(await account(tx=>tx.selectFrom('garmin_strength_summaries').selectAll().execute())).toHaveLength(2);
    const next=await account(tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));expect(next.facts.workoutPoints).toBe(1000);
    await account(tx=>new GarminDayRepository(tx).publish(date,{category:'activities',state:'failed',attemptedAt:new Date(),attempt:{failures:[{identityKey:`native:${snapshot.providerActivityId}`,state:'failed'}]}}));
    const partial=await account(tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(partial.facts.workoutCalculation).toMatchObject({source:'stored',resolvedPoints:1000,incompleteReason:expect.any(String)});
    await account(tx=>new GarminActivitiesRepository(tx).ingest({...snapshot,contentHash:'e'.repeat(64),sourceUpdatedAt:new Date('2026-03-31T10:00:00Z')},normalizeGarminStrength([{exerciseSets:[{repetitions:10}]}])));
    expect((await account(tx=>new DailyScoringRepository(tx).recalculateFromActivities(date))).facts.workoutPoints).toBe(1000);
  });
  it('isolates owner evidence, enforces same-owner source references and append-only writes',async()=>{
    expect(await withAccountContext(db,foreign,tx=>new GarminStrengthRepository(tx).forActivity(activityId))).toBeNull();
    const row=await account(tx=>tx.selectFrom('garmin_strength_summaries').selectAll().executeTakeFirstOrThrow());
    const {derived_at,...insert}=row;
    await expect(withAccountContext(db,foreign,tx=>tx.insertInto('garmin_strength_summaries').values({...insert,owner_id:foreign}).execute())).rejects.toThrow();
    await expect(account(tx=>tx.updateTable('garmin_strength_summaries').set({working_sets:1}).execute())).rejects.toThrow('permission denied');
    await expect(account(tx=>tx.deleteFrom('garmin_strength_summaries').execute())).rejects.toThrow('permission denied');
    for(const value of [process.env.SPORTOS_WORKER_TEST_DATABASE_URL,process.env.SPORTOS_LEGACY_TEST_DATABASE_URL].filter((s):s is string=>Boolean(s))){
      const other=createDb(value);try{await expect(other.selectFrom('garmin_strength_summaries').selectAll().execute()).rejects.toThrow('permission denied');}finally{await other.destroy();}
    }
  });
});
