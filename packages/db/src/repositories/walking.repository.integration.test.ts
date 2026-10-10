import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {sql} from 'kysely';
import {normalizeGarminStrength} from '@sportos/domain';
import {GarminDayRepository} from './garmin-day.repository.js';
import {createDb} from '../pool.js';
import {withAccountContext} from '../ownership-context.js';
import {ProvidersRepository,type ProviderActivitySnapshotInput} from './providers.repository.js';
import {GarminActivitiesRepository} from './garmin-activities.repository.js';
import {ActivitiesRepository} from './activities.repository.js';
import {DailyScoringRepository} from './daily-scoring.repository.js';
const url=process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
(url?describe:describe.skip)('retained walking history with non-owner RLS',()=>{
  let db:ReturnType<typeof createDb>, owner:string,foreign:string,connection:string,batch:string,oldSource:string,newSource:string;
  const raw={id:123,type:'Walk',sport_type:'Walk',start_date:'2095-06-01T10:00:00Z',start_date_local:'2095-06-01T12:00:00',distance:3500,elapsed_time:3000,moving_time:2900};
  const scoped=<T>(fn:Parameters<typeof withAccountContext<T>>[2])=>withAccountContext(db,owner,fn);
  const input=():ProviderActivitySnapshotInput=>({batchId:batch,connectionId:connection,providerActivityId:'123',providerUpdatedAt:null,
    identityFingerprint:'c'.repeat(64),rawHash:'b'.repeat(64),raw,retainedSourceRecordId:newSource,
    activity:{activityDate:'2095-06-01',startTime:new Date(raw.start_date),activityType:'walk',subtype:'outdoor',distanceM:3500,durationS:3000,movingTimeS:2900,
      calories:null,avgHr:null,maxHr:null,elevationGainM:null,avgSpeedMps:null,avgPaceSPerKm:null,notes:null}});
  beforeAll(async()=>{
    if(new URL(url!).hostname!=='127.0.0.1'||!new URL(url!).pathname.endsWith('_test'))throw new Error('Disposable local test database required.');
    db=createDb(url!);
    const role=await sql<{rolsuper:boolean;rolbypassrls:boolean}>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db);
    expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
    owner=(await db.insertInto('accounts').values({display_name:'Synthetic walk',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    foreign=(await db.insertInto('accounts').values({display_name:'Synthetic foreign',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    await scoped(async tx=>{
      connection=(await tx.insertInto('provider_connections').values({provider:'strava',provider_account_id:randomUUID()}).returning('id').executeTakeFirstOrThrow()).id;
      batch=(await tx.insertInto('import_batches').values({source:'strava_api',source_kind:'strava',filename:null,original_sha256:null,status:'normalized',completed_at:null,metadata:{connectionId:connection}}).returning('id').executeTakeFirstOrThrow()).id;
      for(const [hash,distance,created] of [['a',3400,'2095-01-01'],['b',3500,'2095-01-02']] as const){
        const row=await tx.insertInto('source_records').values({import_batch_id:batch,source:'strava_api',source_record_key:'123',sheet_name:null,row_index:null,row_hash:hash.repeat(64),raw_json:{...raw,distance},normalized_entity_type:null,normalized_entity_id:null,status:'skipped',errors:[],warnings:sql`'[ {"code":"UNSUPPORTED_ACTIVITY_TYPE"} ]'::jsonb`,created_at:new Date(created)}).returning('id').executeTakeFirstOrThrow();
        if(hash==='a')oldSource=row.id;else newSource=row.id;
      }
    });
  });
  afterAll(async()=>{await db?.destroy();});
  it('backfills latest source once, links pending Garmin in reverse and preserves raw/history',async()=>{
    const sources=await scoped(tx=>new ProvidersRepository(tx).retainedWalkSources());
    expect(sources).toHaveLength(1);expect(sources[0]!.id).toBe(newSource);
    const garmin=await scoped(tx=>new GarminActivitiesRepository(tx).ingest({provider:'garmin',providerActivityId:'1234',origin:'connect',contentHash:'d'.repeat(64),sourceUpdatedAt:new Date('2095-06-02'),summary:{activityType:'walk',subtype:'outdoor',startTime:new Date(raw.start_date),distanceM:3400,elapsedTimeS:3000.7,movingTimeS:2900}}));
    expect(garmin.activityId).toBeNull();
    const before=await scoped(async tx=>({daily:await tx.selectFrom('daily_metrics').selectAll().execute(),ledger:await tx.selectFrom('score_ledger').selectAll().execute(),snapshots:await tx.selectFrom('daily_score_snapshots').selectAll().execute()}));
    const result=await scoped(tx=>new ProvidersRepository(tx).ingestActivitySnapshot(input()));
    expect(result).toMatchObject({insertedActivity:true,performanceEventWritten:false});
    expect(await scoped(tx=>new GarminActivitiesRepository(tx).get(garmin.id))).toMatchObject({activityId:result.activityId,status:'strong_unique'});
    expect(await scoped(tx=>new ActivitiesRepository(tx).list({activityType:'walk',limit:10,offset:0}))).toMatchObject({summary:{count:1,distanceM:3500}});
    const records=await scoped(tx=>tx.selectFrom('source_records').selectAll().where('id','in',[oldSource,newSource]).execute());
    expect(records).toHaveLength(2);expect(records.every(row=>row.normalized_entity_id===result.activityId&&row.status==='normalized')).toBe(true);
    expect(records.map(row=>row.row_hash).sort()).toEqual(['a'.repeat(64),'b'.repeat(64)]);
    expect(await scoped(tx=>new ProvidersRepository(tx).retainedWalkSources())).toEqual([]);
    expect(await scoped(tx=>new ProvidersRepository(tx).ingestActivitySnapshot(input()))).toMatchObject({insertedActivity:false,activityId:result.activityId});
    const after=await scoped(async tx=>({daily:await tx.selectFrom('daily_metrics').selectAll().execute(),ledger:await tx.selectFrom('score_ledger').selectAll().execute(),snapshots:await tx.selectFrom('daily_score_snapshots').selectAll().execute()}));
    expect(after).toEqual(before);
    await expect(scoped(tx=>new DailyScoringRepository(tx).recalculateFromActivities('2095-06-01'))).rejects.toThrow();
    expect(await scoped(tx=>tx.selectFrom('performance_events').selectAll().execute())).toEqual([]);
  });
  it('keeps distinct native walking IDs separate when all metrics coincide',async()=>{
    const duplicate={...input(),providerActivityId:'124',rawHash:'9'.repeat(64),raw:{...raw,id:124},retainedSourceRecordId:undefined,identityFingerprint:'8'.repeat(64)};
    const result=await scoped(tx=>new ProvidersRepository(tx).ingestActivitySnapshot(duplicate));
    expect(result.insertedActivity).toBe(true);
    expect(await scoped(tx=>tx.selectFrom('activities').selectAll().where('activity_type','=','walk').execute())).toHaveLength(2);
  });
  it('never overwrites a current corrected Strava walk with older retained data',async()=>{
    const current={...input(),retainedSourceRecordId:undefined,rawHash:'3'.repeat(64),raw:{...raw,distance:3600},activity:{...input().activity,distanceM:3600}};
    const result=await scoped(tx=>new ProvidersRepository(tx).ingestActivitySnapshot(current));
    const before=await scoped(tx=>tx.selectFrom('activities').selectAll().where('id','=',result.activityId!).executeTakeFirst());
    await scoped(tx=>new ProvidersRepository(tx).ingestActivitySnapshot(input()));
    expect(await scoped(tx=>tx.selectFrom('activities').selectAll().where('id','=',result.activityId!).executeTakeFirst())).toEqual(before);
    expect(await scoped(tx=>tx.selectFrom('provider_activity_links').select('latest_source_record_id').where('provider_activity_id','=','123').executeTakeFirst())).toEqual({latest_source_record_id:result.sourceRecordId});
  });
  it('retains ambiguous cross-source walks for review without guessing',async()=>{
    const date='2095-06-03',start=new Date(`${date}T10:00:00Z`);
    await scoped(async tx=>{
      for(let i=0;i<2;i++)await tx.insertInto('activities').values({source:'manual',source_activity_id:randomUUID(),activity_date:date,start_time:start,activity_type:'walk',subtype:'outdoor',distance_m:3500,duration_s:3000,moving_time_s:2900}).execute();
    });
    const ambiguous={...input(),providerActivityId:'125',rawHash:'6'.repeat(64),raw:{...raw,id:125},retainedSourceRecordId:undefined,identityFingerprint:'5'.repeat(64),activity:{...input().activity,activityDate:date,startTime:start}};
    const result=await scoped(tx=>new ProvidersRepository(tx).ingestActivitySnapshot(ambiguous));
    expect(result).toMatchObject({activityId:null,warning:'POTENTIAL_DUPLICATE',insertedActivity:false});
    expect(await scoped(tx=>tx.selectFrom('source_records').select(['status','warnings']).where('id','=',result.sourceRecordId).executeTakeFirst())).toMatchObject({status:'skipped',warnings:[{code:'POTENTIAL_DUPLICATE'}]});
  });
  it('does not make walking extraction failures or partial walking history block complete strength scoring',async()=>{
    const date='2095-06-02',start=new Date(`${date}T10:00:00Z`);
    await scoped(async tx=>{
      await sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(tx);
      await tx.insertInto('activities').values({source:'strava',source_activity_id:'gym',activity_date:date,start_time:start,activity_type:'workout',subtype:'indoor',duration_s:1800,moving_time_s:1800,distance_m:0}).execute();
      await new GarminActivitiesRepository(tx).ingest({provider:'garmin',providerActivityId:'5678',origin:'connect',contentHash:'e'.repeat(64),sourceUpdatedAt:new Date('2095-06-03'),summary:{activityType:'workout',subtype:'indoor',startTime:start,elapsedTimeS:1800,movingTimeS:900,distanceM:0}},normalizeGarminStrength([{exerciseSets:Array.from({length:6},()=>({setType:'ACTIVE'}))}]));
      await new GarminDayRepository(tx).publish(date,{category:'activities',state:'failed',attemptedAt:new Date(),version:{hash:'f'.repeat(64),availability:'available',projection:{identities:['native:1234','native:5678'],complete:false,workoutComplete:true}},attempt:{excludedIdentities:['native:1234'],failures:[{identityKey:'native:1234',state:'failed'}]}});
    });
    const result=await scoped(tx=>new DailyScoringRepository(tx).recalculateFromActivities(date));
    expect(result.facts.workoutCalculation).toMatchObject({source:'garmin_sets',workingSets:6,resolvedPoints:2000});
    expect(result.facts.workoutCalculation?.incompleteReason).toBeUndefined();
  });
  it('denies foreign source replay and foreign walking history',async()=>{
    expect(await withAccountContext(db,foreign,tx=>new ProvidersRepository(tx).retainedWalkSources())).toEqual([]);
    await expect(withAccountContext(db,foreign,tx=>new ProvidersRepository(tx).ingestActivitySnapshot(input()))).rejects.toThrow('Invalid retained walk source');
    expect(await withAccountContext(db,foreign,tx=>new ActivitiesRepository(tx).list({activityType:'walk',limit:10,offset:0}))).toMatchObject({items:[],summary:{count:0}});
  });
});
