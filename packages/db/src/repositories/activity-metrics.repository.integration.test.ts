import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import type { Database, Json } from '../schema.js';
import { ActivityMetricsRepository, type MetricReference, type ProjectionWrite } from './activity-metrics.repository.js';
import { ActivitiesRepository } from './activities.repository.js';
import { GarminActivitiesRepository } from './garmin-activities.repository.js';
import { ActivityProviderResourcesRepository } from './activity-provider-resources.repository.js';
import { GarminActivityResourcesRepository } from './garmin-activity-resources.repository.js';
import { RetainedActivityMetricsProjector } from '../activity-metric-projector.js';
import { backfillRetainedActivityMetrics } from '../activity-metric-backfill.js';
const primaryUrl=process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const detailUrl=process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
const integration=primaryUrl && detailUrl ? describe : describe.skip;
/** Synthetic data only. Append-only evidence stays in a disposable test DB. */
integration('retained activity metric projections under non-owner RLS',()=>{
  let primary:Kysely<Database>; let detail:Kysely<Database>; let owner:string; let foreign:string;
  const scoped=<T>(fn:(db:Kysely<Database>)=>Promise<T>,account=owner)=>withAccountContext(primary,account,fn);
  const rich=<T>(fn:(db:Kysely<Database>)=>Promise<T>,account=owner)=>withAccountContext(detail,account,fn);
  const project=(id:string,dry=false,account=owner)=>scoped(db=>new RetainedActivityMetricsProjector(db,fn=>rich(fn,account)).project(id,dry),account);
  beforeAll(async()=>{
    primary=createDb(primaryUrl!);detail=createDb(detailUrl!);
    for (const db of [primary,detail]) {
      const role=await sql<{rolsuper:boolean;rolbypassrls:boolean}>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db);
      expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
    }
    owner=await account();foreign=await account();
  });
  afterAll(async()=>{await primary?.destroy();await detail?.destroy();vi.restoreAllMocks();});
  async function account() {return (await primary.insertInto('accounts').values({display_name:`Metrics ${randomUUID()}`,email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;}
  async function fixture(raw:Json={distance:10020,elapsed_time:3100,moving_time:3000,average_heartrate:150,average_watts:230,suffer_score:40}) {
    return scoped(async db=>{
      const native=String(Math.floor(Math.random()*1e12));const time=new Date('2095-01-01T10:00:00Z');
      const connection=(await db.selectFrom('provider_connections').select('id').where('provider','=','strava').executeTakeFirst())?.id ?? (await db.insertInto('provider_connections').values({provider:'strava',provider_account_id:randomUUID(),display_name:null,scopes:[],status:'connected',access_expires_at:null,cursor_json:{}}).returning('id').executeTakeFirstOrThrow()).id;
      const batch=(await db.insertInto('import_batches').values({source:'strava_api',source_kind:'strava',filename:null,original_sha256:null,status:'normalized',completed_at:null,metadata:{}}).returning('id').executeTakeFirstOrThrow()).id;
      const hash=createHash('sha256').update(JSON.stringify(raw)).digest('hex');
      const source=(await db.insertInto('source_records').values({import_batch_id:batch,source:'strava_api',sheet_name:null,row_index:null,source_record_key:native,row_hash:hash,raw_json:raw,normalized_entity_type:null,normalized_entity_id:null,status:'raw',errors:[],warnings:[]}).returning('id').executeTakeFirstOrThrow()).id;
      const activity=(await db.insertInto('activities').values({source:'strava',source_record_id:source,source_activity_id:native,activity_type:'run',subtype:'outdoor',activity_date:'2095-01-01',start_time:time,distance_m:10020,duration_s:3100,moving_time_s:3000,avg_pace_s_per_km:3000*1000/10020}).returning('id').executeTakeFirstOrThrow()).id;
      const link=(await db.insertInto('provider_activity_links').values({connection_id:connection,provider_activity_id:native,activity_id:activity,latest_source_record_id:source,identity_fingerprint:hash,fingerprint_version:1,availability:'available',provider_updated_at:null}).returning('id').executeTakeFirstOrThrow()).id;
      return {activity,native,hash,source,batch,link,time,connection};
    });
  }
  async function stravaRich(f:Awaited<ReturnType<typeof fixture>>,payload:Json={distance:10020,elapsed_time:3100,moving_time:3000,average_watts:231},version=f.hash) {
    await rich(db=>new ActivityProviderResourcesRepository(db).replace({activityId:f.activity,provider:'strava',providerActivityId:f.native,connectionId:f.connection,providerVersion:version},[{resourceType:'detail',availability:'available',httpStatus:200,payload}]));
  }
  async function head(id:string,provider:'strava'|'garmin'='strava') {return scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',id).where('provider','=',provider).executeTakeFirstOrThrow());}
  async function facts() {return scoped(async db=>({activities:await db.selectFrom('activities').selectAll().orderBy('id').execute(),daily:await db.selectFrom('daily_metrics').selectAll().execute(),ledger:await db.selectFrom('score_ledger').selectAll().execute(),snapshots:await db.selectFrom('daily_score_snapshots').selectAll().execute(),performance:await db.selectFrom('performance_events').selectAll().execute()}));}
  it('preserves provider distance disagreement, independent provenance and official facts offline',async()=>{
    const f=await fixture();await stravaRich(f);
    // Make this fixture uniquely matchable even as subsequent tests create runs.
    const garmin=await scoped(db=>new GarminActivitiesRepository(db).ingest({provider:'garmin',providerActivityId:'80001',contentHash:'a'.repeat(64),origin:'connect',sourceUpdatedAt:f.time,
      summary:{activityType:'run',subtype:'outdoor',startTime:f.time,elapsedTimeS:3100,movingTimeS:3000,distanceM:10000}}));
    expect(garmin.activityId).toBe(f.activity);
    await rich(async db=>{const repo=new GarminActivityResourcesRepository(db);const ref={identityKey:'native:80001',sourceHash:'a'.repeat(64)};
      for (const resourceType of ['detail','sets'] as const) await repo.retain(ref,{resourceType,chunkIndex:0,payload:{}});
      await repo.retain(ref,{resourceType:'records',chunkIndex:0,payload:[{message:'session',fields:[{name:'total_distance',value:10000,units:'m'},{name:'avg_running_cadence',value:90,units:'strides/min'},{name:'avg_stance_time',value:250,units:'ms'}]}]});
      await repo.retain(ref,{resourceType:'fit_manifest',chunkIndex:0,payload:{expectedResources:['detail','sets','records'].map(resourceType=>({resourceType,chunkIndex:0}))}});
    });
    await scoped(async db=>{
      await sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(db);
      await db.insertInto('daily_metrics').values({metric_date:'2095-01-01',source_record_id:null,steps:1000,run_m:10020,bike_m:0,swim_m:0,workout_points:0,base_points:123,bonus_points:0,total_points:123,excel_all_points:null,excel_row_hash:null}).execute();
      const rule=await db.selectFrom('scoring_rules').select('id').where('code','=','run.km.default').executeTakeFirstOrThrow();
      await db.insertInto('score_ledger').values({metric_date:'2095-01-01',activity_id:f.activity,rule_id:rule.id,points:123,reason:'Synthetic test',calculation_json:{input:10020}}).execute();
    });
    const before=await facts();const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No network allowed'));
    expect((await project(f.activity)).map(r=>r.category)).toEqual(['newly_projected','newly_projected']);
    const result=await scoped(db=>new ActivitiesRepository(db).get(f.activity));
    expect(result?.metricComparisons.find(m=>m.key==='distance')).toMatchObject({selected:{value:10020,source:'strava'},candidates:expect.arrayContaining([expect.objectContaining({provider:'strava',value:10020}),expect.objectContaining({provider:'garmin',value:10000})])});
    expect(result?.providerMetrics.map(s=>s.state)).toEqual(['processed','processed']);
    const heads=await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',f.activity).orderBy('provider').execute());
    expect((await project(f.activity)).map(r=>r.category)).toEqual(['already_current','already_current']);
    expect(await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',f.activity).orderBy('provider').execute())).toEqual(heads);
    expect(await facts()).toEqual(before);expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();
    expect(JSON.stringify(result)).not.toContain(f.hash);expect(JSON.stringify(result)).not.toContain(owner);
    // List/detail use the primary projection; no rich-resource reads are needed.
    const raw=vi.spyOn(GarminActivityResourcesRepository.prototype,'messages');
    await scoped(db=>new ActivitiesRepository(db).list({limit:50,offset:0}));await scoped(db=>new ActivitiesRepository(db).get(f.activity));expect(raw).not.toHaveBeenCalled();raw.mockRestore();
  });
  it('projects compact-only and valid empty rich activities truthfully, with source-backed fallback',async()=>{
    const f=await fixture({});expect((await project(f.activity))[0]).toMatchObject({compactOnly:true,linkedButUnretained:true});
    let activity=await scoped(db=>new ActivitiesRepository(db).get(f.activity));expect(activity?.providerMetrics[0]).toMatchObject({state:'partial',rawRetained:false});
    expect(activity?.metricComparisons.find(m=>m.key==='distance')?.candidates[0]).toMatchObject({sourceKind:'canonical_fallback',value:10020});
    await stravaRich(f,{});expect((await project(f.activity))[0]?.category).toBe('newly_projected');
    activity=await scoped(db=>new ActivitiesRepository(db).get(f.activity));expect(activity?.providerMetrics[0]?.state).toBe('processed');
    await scoped(db=>db.updateTable('activities').set({source:'manual'}).where('id','=',f.activity).execute());
    await project(f.activity);
    expect((await scoped(db=>new ActivitiesRepository(db).get(f.activity)))?.providerMetrics[0]).toMatchObject({state:'processed',valueCount:0});
    expect((await scoped(db=>new ActivitiesRepository(db).get(f.activity)))?.metricComparisons.find(m=>m.key==='distance')?.candidates).toEqual([]);
    const manual=await scoped(db=>db.insertInto('activities').values({source:'manual',activity_type:'workout',activity_date:'2095-01-02'}).returning('id').executeTakeFirstOrThrow());
    expect(await project(manual.id)).toEqual([]);
    expect((await scoped(db=>new ActivitiesRepository(db).get(manual.id)))?.providerMetrics).toEqual([]);
  });
  it('reports stale rich cache and source-head/parser mismatches without presenting old rich values as current',async()=>{
    const f=await fixture();await stravaRich(f,{average_watts:250},'e'.repeat(64));
    expect((await project(f.activity))[0]?.missingCategories).toEqual(['stale_detail']);
    expect((await scoped(db=>new ActivitiesRepository(db).get(f.activity)))?.providerMetrics[0]?.state).toBe('stale');
    await stravaRich(f);await project(f.activity);
    const source=await scoped(db=>db.insertInto('source_records').values({import_batch_id:f.batch,source:'strava_api',sheet_name:null,row_index:null,source_record_key:f.native,row_hash:'d'.repeat(64),raw_json:{distance:10030},normalized_entity_type:null,normalized_entity_id:null,status:'raw',errors:[],warnings:[]}).returning('id').executeTakeFirstOrThrow());
    await scoped(db=>db.updateTable('provider_activity_links').set({latest_source_record_id:source.id}).where('id','=',f.link).execute());
    const result=await scoped(db=>new ActivitiesRepository(db).get(f.activity));expect(result?.providerMetrics[0]?.state).toBe('stale');expect(result?.metricComparisons.find(m=>m.key==='average_power')).toBeUndefined();
    const ref=(await scoped(db=>new ActivityMetricsRepository(db).references([f.activity])))[0]!;
    const old={...ref,sourceVersion:f.hash};
    await expect(scoped(db=>new ActivityMetricsRepository(db).publish({reference:old,inputHash:'b'.repeat(64),inspectedAt:new Date(),observations:[],missing:0,rejected:0,richRetained:true,compactOnly:false,state:'processed'}))).resolves.toBe('stale');
  });
  it('keeps successful data on read failure, reports safe category, retries and rejects out-of-order publication',async()=>{
    const f=await fixture();await stravaRich(f);await project(f.activity);const success=await head(f.activity);
    const result=await scoped(db=>new RetainedActivityMetricsProjector(db,async()=>{throw new Error('private path/token must never escape');}).project(f.activity));
    expect(result[0]?.category).toBe('errors');expect(JSON.stringify(result)).not.toContain('private');
    const failed=await head(f.activity);expect(failed.projection_id).toBe(success.projection_id);
    expect(failed.failure_category).toBe('retained_read_failed');
    const response=await scoped(db=>new ActivitiesRepository(db).get(f.activity));expect(response?.providerMetrics[0]?.state).toBe('failed');expect(response?.metricComparisons.find(m=>m.key==='distance')?.candidates.length).toBeGreaterThan(0);
    await project(f.activity);expect((await head(f.activity)).state).toBe('processed');
    const reference=(await scoped(db=>new ActivityMetricsRepository(db).references([f.activity])))[0]!;
    const write:ProjectionWrite={reference,inputHash:'f'.repeat(64),inspectedAt:new Date(Date.now()-86400000),observations:[],missing:0,rejected:0,state:'processed',compactOnly:false,richRetained:true};
    await expect(scoped(db=>new ActivityMetricsRepository(db).publish(write))).resolves.toBe('stale');
    expect((await head(f.activity)).projection_id).toBe(success.projection_id);
  });
  it('preserves sub-millisecond inspection ordering in Postgres',async()=>{
    const f=await fixture();await project(f.activity);
    const reference=(await scoped(db=>new ActivityMetricsRepository(db).references([f.activity])))[0]!;
    await scoped(db=>db.updateTable('activity_metric_heads').set({inspected_at:'2090-01-01 00:00:00.123987+00'}).where('activity_id','=',f.activity).execute());
    const write:ProjectionWrite={reference,inputHash:'b'.repeat(64),inspectedAt:'2090-01-01 00:00:00.123456+00',observations:[],missing:0,rejected:0,state:'processed',compactOnly:false,richRetained:true};
    await expect(scoped(db=>new ActivityMetricsRepository(db).checkpoint(write))).resolves.toBe(false);
    await expect(scoped(db=>new ActivityMetricsRepository(db).publish(write))).resolves.toBe('stale');
    await scoped(db=>db.updateTable('activity_metric_heads').set({inspected_at:new Date(0)}).where('activity_id','=',f.activity).execute());
  });
  it('supports dry run, bounded batches, interrupted replay and deterministic cursor resume without network',async()=>{
    const before=await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().orderBy('activity_id').execute());
    const first=await scoped(db=>backfillRetainedActivityMetrics(db,fn=>rich(fn),{limit:1,dryRun:true}));expect(first.processedActivities).toBe(1);expect(first.hasMore).toBe(true);
    expect(await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().orderBy('activity_id').execute())).toEqual(before);
    const apply=await scoped(db=>backfillRetainedActivityMetrics(db,fn=>rich(fn),{limit:1,dryRun:false}));
    const replay=await scoped(db=>backfillRetainedActivityMetrics(db,fn=>rich(fn),{limit:1,dryRun:false}));expect(replay.nextCursor).toBe(apply.nextCursor);expect(replay.providers.strava.newlyProjected+replay.providers.garmin.newlyProjected).toBe(0);
    const next=await scoped(db=>backfillRetainedActivityMetrics(db,fn=>rich(fn),{cursor:apply.nextCursor!,limit:1,dryRun:false}));expect(next.nextCursor!>apply.nextCursor!).toBe(true);
    expect(next.fetched).toBe(false);expect(next.scoreWrites).toBe(false);
  });
  it('batches metadata while preserving per-activity inspection, ownership and dry-run results',async()=>{
    const f=await fixture();
    const references=vi.spyOn(ActivityMetricsRepository.prototype,'references');
    const batch=await scoped(db=>new RetainedActivityMetricsProjector(db,fn=>rich(fn)).projectBatch([f.activity],true));
    expect(references).toHaveBeenCalledTimes(1);references.mockRestore();
    expect(batch.get(f.activity)).toEqual(await project(f.activity,true));
    expect(await scoped(db=>new RetainedActivityMetricsProjector(db,fn=>rich(fn,foreign)).projectBatch([f.activity],true),foreign)).toEqual(new Map());
    await expect(scoped(db=>new RetainedActivityMetricsProjector(db,fn=>rich(fn)).projectBatch(Array(101).fill(f.activity),true))).rejects.toThrow('batch exceeds limit');
  });
  it('publishes multiple activities in bounded bulk phases and leaves unchanged replay untouched',async()=>{
    const fixtures=await Promise.all([fixture(),fixture(),fixture()]);
    const refs=await scoped(db=>new ActivityMetricsRepository(db).references(fixtures.map(f=>f.activity)));
    const writes:ProjectionWrite[]=refs.map(reference=>({reference,inputHash:'d'.repeat(64),inspectedAt:new Date(),state:'processed',richRetained:true,compactOnly:false,missing:0,rejected:0,
      observations:Array.from({length:200},(_,i)=>({metricKey:'distance',value:10000+i,unit:'m',sourceKind:'compact',sourceField:`field_${i}`,sourceUnit:'m',origin:'provider_derived',precedence:10}))}));
    const first=await scoped(db=>new ActivityMetricsRepository(db).publishBatch(writes));expect([...first.values()]).toEqual(Array(3).fill('newly_projected'));
    expect(Number((await scoped(db=>db.selectFrom('activity_provider_metric_values').select(eb=>eb.fn.countAll<string>().as('n')).where('activity_id','in',fixtures.map(f=>f.activity)).executeTakeFirstOrThrow())).n)).toBe(600);
    const before=await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','in',fixtures.map(f=>f.activity)).orderBy('activity_id').execute());
    const replay=await scoped(db=>new ActivityMetricsRepository(db).publishBatch(writes.map(w=>({...w,inspectedAt:new Date()}))));expect([...replay.values()]).toEqual(Array(3).fill('already_current'));
    expect(await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','in',fixtures.map(f=>f.activity)).orderBy('activity_id').execute())).toEqual(before);
    await expect(scoped(db=>new ActivityMetricsRepository(db).publishBatch([writes[0]!,writes[0]!]))).rejects.toThrow('repeats a provider');
  });
  it('retains a committed bulk checkpoint when publication fails, then converges on normal replay',async()=>{
    const f=await fixture();await project(f.activity);
    const reference=(await scoped(db=>new ActivityMetricsRepository(db).references([f.activity])))[0]!;
    const before=await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',f.activity).executeTakeFirstOrThrow());
    const write:ProjectionWrite={reference,inputHash:'e'.repeat(64),inspectedAt:new Date(),state:'processed',richRetained:true,compactOnly:false,missing:0,rejected:0,
      observations:[{metricKey:'distance',value:-200,unit:'m',sourceKind:'compact',sourceField:'distance',sourceUnit:'m',origin:'provider_derived',precedence:10}]};
    await expect(scoped(db=>new ActivityMetricsRepository(db).publishBatch([write]))).rejects.toThrow();
    const pending=await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',f.activity).executeTakeFirstOrThrow());
    expect(pending.state).toBe('unprocessed');expect(pending.projection_id).toBe(before.projection_id);
    expect(pending.expected_input_hash).toBe(write.inputHash);
    await project(f.activity);expect((await scoped(db=>new ActivityMetricsRepository(db).statuses([f.activity])))[f.activity]?.find(s=>s.provider==='strava')?.state).toBe('partial');
  });
  it('bulk publication preserves precise freshness checks, source membership and foreign-owner isolation',async()=>{
    const f=await fixture();await project(f.activity);
    const reference=(await scoped(db=>new ActivityMetricsRepository(db).references([f.activity])))[0]!;
    const write:ProjectionWrite={reference,inputHash:'e'.repeat(64),inspectedAt:'2090-01-01 00:00:00.123456+00',state:'processed',richRetained:true,compactOnly:false,missing:0,rejected:0,observations:[]};
    await scoped(db=>db.updateTable('activity_metric_heads').set({inspected_at:'2090-01-01 00:00:00.123987+00'}).where('activity_id','=',f.activity).execute());
    expect([...(await scoped(db=>new ActivityMetricsRepository(db).publishBatch([write]))).values()]).toEqual(['stale']);
    expect([...(await scoped(db=>new ActivityMetricsRepository(db).publishBatch([{...write,reference:{...reference,sourceVersion:'f'.repeat(64)},inspectedAt:'2091-01-01'}]))).values()]).toEqual(['stale']);
    expect([...(await scoped(db=>new ActivityMetricsRepository(db).publishBatch([write]),foreign)).values()]).toEqual(['stale']);
  });
  it('never forces a pending Garmin link and allows later retained-only projection after explicit review',async()=>{
    const f=await fixture();const pending=await scoped(db=>new GarminActivitiesRepository(db).ingest({provider:'garmin',providerActivityId:'80002',contentHash:'c'.repeat(64),origin:'connect',sourceUpdatedAt:new Date('2095-02-01'),summary:{activityType:'run',subtype:'outdoor',startTime:new Date('2095-02-01'),elapsedTimeS:3100,movingTimeS:3000,distanceM:10000}}));
    expect(pending.activityId).toBeNull();
    const report=await scoped(db=>backfillRetainedActivityMetrics(db,fn=>rich(fn),{limit:100,dryRun:true}));expect(report.providers.garmin.pending).toBeGreaterThan(0);
    await scoped(db=>new GarminActivitiesRepository(db).review(pending.id,'link',f.activity));
    expect((await project(f.activity)).find(r=>r.provider==='garmin')).toMatchObject({compactOnly:true,category:'newly_projected'});
  });
  it('does not advance failed batches and retry errors contain no private source content',async()=>{
    const f=await fixture();
    const start=await scoped(db=>db.selectFrom('activities').select('id').where('id','<',f.activity).orderBy('id','desc').executeTakeFirst());
    const report=await scoped(db=>backfillRetainedActivityMetrics(db,async()=>{throw new Error('private raw error');},{limit:1,dryRun:false,cursor:start?.id}));
    expect(report.providers.strava.errors).toBe(1);expect(report.nextCursor).toBe(start?.id ?? null);expect(JSON.stringify(report)).not.toContain('private raw');
    await project(f.activity);
  });
  it('records raw-retained/unprocessed after interruption and preserves history without blocking canonical deletion',async()=>{
    const f=await fixture();
    const reference=(await scoped(db=>new ActivityMetricsRepository(db).references([f.activity])))[0]!;
    const write:ProjectionWrite={reference,inputHash:'c'.repeat(64),inspectedAt:new Date(),observations:[],missing:0,rejected:0,state:'processed',compactOnly:false,richRetained:true};
    await scoped(db=>new ActivityMetricsRepository(db).checkpoint(write));
    expect((await scoped(db=>new ActivitiesRepository(db).get(f.activity)))?.providerMetrics[0]?.state).toBe('raw_retained_unprocessed');
    await scoped(db=>new ActivityMetricsRepository(db).publish(write));
    await scoped(db=>db.deleteFrom('provider_activity_links').where('id','=',f.link).execute());
    await scoped(db=>db.deleteFrom('activities').where('id','=',f.activity).execute());
    expect(await scoped(db=>db.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',f.activity).execute())).toEqual([]);
    expect(await scoped(db=>db.selectFrom('activity_metric_projections').selectAll().where('activity_id','=',f.activity).execute())).toHaveLength(1);
  });
  it('isolates foreign identifiers, immutable history/owners, same-owner references and dispatcher privileges',async()=>{
    const f=await fixture();await project(f.activity);
    expect(await project(f.activity,false,foreign)).toEqual([]);expect(await scoped(db=>new ActivitiesRepository(db).get(f.activity),foreign)).toBeNull();
    expect(await scoped(db=>db.selectFrom('activity_provider_metric_values').selectAll().where('activity_id','=',f.activity).execute(),foreign)).toEqual([]);
    await expect(scoped(db=>db.updateTable('activity_provider_metric_values').set({value:0}).where('activity_id','=',f.activity).execute())).rejects.toThrow('permission denied');
    await expect(scoped(db=>db.deleteFrom('activity_metric_projections').where('activity_id','=',f.activity).execute())).rejects.toThrow('permission denied');
    await expect(scoped(db=>db.updateTable('activity_metric_heads').set({owner_id:foreign}).where('activity_id','=',f.activity).execute())).rejects.toThrow('immutable');
    const h=await head(f.activity);await expect(scoped(db=>db.insertInto('activity_metric_heads').values({activity_id:f.activity,provider:'strava',source_ref:f.link,source_version:f.hash,projection_id:h.projection_id,state:'processed',rich_retained:true,failure_category:null}).execute(),foreign)).rejects.toThrow();
    if (process.env.SPORTOS_WORKER_DATA_TEST_DATABASE_URL) {
      const worker=createDb(process.env.SPORTOS_WORKER_DATA_TEST_DATABASE_URL);
      try {
        expect((await withAccountContext(worker,owner,db=>new ActivityMetricsRepository(db).statuses([f.activity])))[f.activity]![0]?.linked).toBe(true);
        expect(await withAccountContext(worker,foreign,db=>db.selectFrom('activity_provider_metric_values').selectAll().where('activity_id','=',f.activity).execute())).toEqual([]);
      } finally {await worker.destroy();}
    }
    if (process.env.SPORTOS_WORKER_TEST_DATABASE_URL) {const dispatcher=createDb(process.env.SPORTOS_WORKER_TEST_DATABASE_URL);try {for(const table of ['activity_metric_heads','activity_metric_projections','activity_provider_metric_values'] as const) await expect(dispatcher.selectFrom(table).selectAll().execute()).rejects.toThrow('permission denied');}finally{await dispatcher.destroy();}}
  });
});
