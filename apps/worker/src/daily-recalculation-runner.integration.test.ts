import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createDb,DailyRecalculationRepository,DailyRecalculationDispatchRepository,DailyScoringRepository,GarminDayRepository,withAccountContext,shiftScoringDate,sql,type Database,type Kysely} from '@sportos/db';
import {DailyRecalculationRunner} from './daily-recalculation-runner.js';
const urls={app:process.env.SPORTOS_GARMIN_TEST_APP_URL,data:process.env.SPORTOS_GARMIN_TEST_DATA_URL,dispatch:process.env.SPORTOS_GARMIN_TEST_DISPATCH_URL};
const integration=Object.values(urls).every(Boolean)?describe:describe.skip;
integration('retained daily recalculation through non-owner roles',()=>{
 let app:Kysely<Database>,data:Kysely<Database>,dispatch:Kysely<Database>;
 const scoped=<T>(pool:Kysely<Database>,owner:string,fn:(repo:DailyRecalculationRepository)=>Promise<T>)=>withAccountContext(pool,owner,db=>fn(new DailyRecalculationRepository(db)));
 const worker=()=>new DailyRecalculationRunner(dispatch,data,'calculation-test');
 const today=async(zone='Europe/Copenhagen')=>(await sql<{date:string}>`select (now() AT TIME ZONE ${zone})::date::text as date`.execute(app)).rows[0]!.date;
 async function account(){const owner=(await app.insertInto('accounts').values({display_name:'Synthetic scoring cursor',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;await withAccountContext(app,owner,db=>sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(db));return owner}
 async function evidence(owner:string,date:string,steps=100){await withAccountContext(app,owner,db=>new GarminDayRepository(db).publish(date,{category:'summary',state:'available',attemptedAt:new Date(),version:{hash:createHash('sha256').update(date+':'+steps).digest('hex'),availability:'available',projection:{steps}}}))}
 async function snapshots(owner:string){return withAccountContext(app,owner,db=>db.selectFrom('daily_score_snapshots').select(['metric_date','facts_json']).orderBy('created_at').execute())}
 beforeAll(async()=>{
  for(const value of Object.values(urls))if(new URL(value!).hostname!=='127.0.0.1')throw new Error('Disposable loopback databases required');
  app=createDb(urls.app!);data=createDb(urls.data!);dispatch=createDb(urls.dispatch!);
  for(const db of [app,data,dispatch])expect((await sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
 });
 afterAll(async()=>{vi.restoreAllMocks();await Promise.all([app?.destroy(),data?.destroy(),dispatch?.destroy()])});
 it('does not mutate on GET; initializes once, deduplicates active submissions, and repeats today ten times without completing it',async()=>{
  const owner=await account(),date=await today(),start=shiftScoringDate(date,-2),yesterday=shiftScoringDate(date,-1);
  await scoped(app,owner,repo=>repo.state());expect(await withAccountContext(app,owner,db=>db.selectFrom('daily_recalculation_cursors').selectAll().execute())).toHaveLength(0);
  await scoped(data,owner,repo=>repo.initialize(start,'Europe/Copenhagen'));
  await expect(scoped(data,owner,repo=>repo.initialize(start,'Europe/Copenhagen'))).rejects.toMatchObject({code:'CURSOR_ALREADY_SET'});
  for(const day of [start,yesterday,date])await evidence(owner,day);
  const job=await scoped(app,owner,repo=>repo.enqueue());expect(job).toMatchObject({from:start,to:date,totalDays:3});
  expect((await Promise.all([scoped(app,owner,repo=>repo.enqueue()),scoped(app,owner,repo=>repo.enqueue())])).map(j=>j.id)).toEqual([job.id,job.id]);
  for(let i=0;i<3;i++)expect(await worker().processNext()).toBe(true);
  expect(await scoped(app,owner,repo=>repo.get(job.id))).toMatchObject({status:'succeeded',processedDays:3});
  const cursor=(await scoped(app,owner,repo=>repo.state())).cursor;expect(cursor.completedThrough).toBe(yesterday);
  // Ten fresh runs today must observe changing retained evidence each time.
  for(let i=0;i<10;i++){
   await evidence(owner,date,200+i);const next=await scoped(app,owner,repo=>repo.enqueue());expect(next.id).not.toBe(job.id);expect(next).toMatchObject({from:date,to:date,totalDays:1});
   await worker().processNext();expect(await scoped(app,owner,repo=>repo.get(next.id))).toMatchObject({status:'succeeded',processedDays:1});
   expect((await scoped(app,owner,repo=>repo.state())).cursor).toEqual(cursor);
  }
  const history=await snapshots(owner);expect(history).toHaveLength(13);expect(history.at(-1)?.facts_json).toMatchObject({steps:209});
 });
 it('does not advance over missing evidence; retry preserves prior checkpoints and recalculates the failed date',async()=>{
  const owner=await account(),date=await today(),start=shiftScoringDate(date,-2),missing=shiftScoringDate(date,-1);
  await scoped(data,owner,repo=>repo.initialize(start,'Europe/Copenhagen'));await evidence(owner,start);await evidence(owner,date);
  const job=await scoped(app,owner,repo=>repo.enqueue());await worker().processNext();await worker().processNext();
  expect(await scoped(app,owner,repo=>repo.get(job.id))).toMatchObject({status:'failed',nextDate:missing,errorCode:'DAILY_DATA_UNAVAILABLE',processedDays:1});
  expect((await scoped(app,owner,repo=>repo.state())).cursor.completedThrough).toBe(start);expect(await snapshots(owner)).toHaveLength(1);
  await evidence(owner,missing);const retry=await scoped(app,owner,repo=>repo.retry(job.id));expect(retry.from).toBe(missing);
  await worker().processNext();await worker().processNext();expect(await scoped(app,owner,repo=>repo.get(retry.id))).toMatchObject({status:'succeeded'});
 });
 it('cancels queued/running work, preserves checkpoints, and rolls scores back on a scoring exception',async()=>{
  const owner=await account(),date=await today();await scoped(data,owner,repo=>repo.initialize(date,'Europe/Copenhagen'));await evidence(owner,date);
  const queued=await scoped(app,owner,repo=>repo.enqueue());await scoped(app,owner,repo=>repo.cancel(queued.id));await worker().processNext();
  expect(await scoped(app,owner,repo=>repo.get(queued.id))).toMatchObject({status:'cancelled'});expect(await snapshots(owner)).toHaveLength(0);
  const running=await scoped(app,owner,repo=>repo.retry(queued.id));const claim=await new DailyRecalculationDispatchRepository(dispatch).claim('cancel-worker');expect(claim?.id).toBe(running.id);
  await scoped(app,owner,repo=>repo.cancel(running.id));await scoped(data,owner,repo=>repo.process(running.id,'cancel-worker'));expect(await snapshots(owner)).toHaveLength(0);
  const failed=await scoped(app,owner,repo=>repo.retry(running.id));
  const original=DailyScoringRepository.prototype.recalculateFromActivitiesInTransaction;
  const spy=vi.spyOn(DailyScoringRepository.prototype,'recalculateFromActivitiesInTransaction').mockImplementation(async function(this:DailyScoringRepository,...args:Parameters<typeof original>){await original.apply(this,args);throw new Error('Synthetic failure after score writes')});
  await worker().processNext();spy.mockRestore();expect(await snapshots(owner)).toHaveLength(0);
  expect(await scoped(app,owner,repo=>repo.get(failed.id))).toMatchObject({status:'failed',processedDays:0,errorCode:'DAILY_RECALCULATION_FAILED'});
  expect((await scoped(app,owner,repo=>repo.state())).cursor.completedThrough).toBeNull();
 });
 it('recovers expired leases and fences the old worker, including a shutdown rollback',async()=>{
  const owner=await account(),date=await today();await scoped(data,owner,repo=>repo.initialize(date,'Europe/Copenhagen'));await evidence(owner,date);
  const job=await scoped(app,owner,repo=>repo.enqueue());await new DailyRecalculationDispatchRepository(dispatch).claim('old-worker');
  await withAccountContext(data,owner,db=>db.updateTable('daily_recalculation_jobs').set({lease_expires_at:new Date(0)}).where('id','=',job.id).execute());
  const claim=await new DailyRecalculationDispatchRepository(dispatch).claim('new-worker');expect(claim?.id).toBe(job.id);
  await expect(scoped(data,owner,repo=>repo.process(job.id,'old-worker'))).rejects.toMatchObject({code:'LEASE_LOST'});
  const abort=new AbortController();abort.abort();await expect(scoped(data,owner,repo=>repo.process(job.id,'new-worker',abort.signal))).rejects.toMatchObject({code:'LEASE_LOST'});expect(await snapshots(owner)).toHaveLength(0);
  await scoped(data,owner,repo=>repo.process(job.id,'new-worker'));expect(await scoped(app,owner,repo=>repo.get(job.id))).toMatchObject({status:'succeeded'});
 });
 it('uses the persisted calendar across midnight, while an earlier fixed job window can become final',async()=>{
  const zone='Pacific/Honolulu',owner=await account(),date=await today(zone),prior=shiftScoringDate(date,-1);
  await scoped(data,owner,repo=>repo.initialize(prior,zone));await evidence(owner,prior);
  // Model a job queued before midnight with its end date already fixed.
  const job=await withAccountContext(app,owner,db=>db.insertInto('daily_recalculation_jobs').values({from_date:prior,to_date:prior,next_date:prior,time_zone:zone}).returning('id').executeTakeFirstOrThrow());
  await worker().processNext();expect(await scoped(app,owner,repo=>repo.get(job.id))).toMatchObject({status:'succeeded'});
  expect((await scoped(app,owner,repo=>repo.state())).cursor).toMatchObject({timeZone:zone,completedThrough:prior});
  expect((await scoped(app,owner,repo=>repo.enqueue())).to).toBe(date);
  const activeJob=(await scoped(app,owner,repo=>repo.state())).activeJob!;await scoped(app,owner,repo=>repo.cancel(activeJob.id));await worker().processNext();
 });
 it('enforces foreign/missing identifier equivalence, cursor ownership/immutability, and dispatcher exclusions',async()=>{
  const owner=await account(),foreign=await account(),date=await today();await scoped(data,owner,repo=>repo.initialize(date,'Europe/Copenhagen'));const job=await scoped(app,owner,repo=>repo.enqueue());
  expect(await scoped(app,foreign,repo=>repo.get(job.id))).toBeNull();expect(await scoped(app,foreign,repo=>repo.cancel(job.id))).toBeNull();await expect(scoped(app,foreign,repo=>repo.retry(job.id))).rejects.toMatchObject({code:'NOT_FOUND'});
  await expect(withAccountContext(app,owner,db=>db.updateTable('daily_recalculation_cursors').set({completed_through:date}).execute())).rejects.toThrow(/permission denied/);
  await expect(withAccountContext(data,owner,db=>db.updateTable('daily_recalculation_cursors').set({completed_through:date}).execute())).rejects.toThrow(/unfinished calendar day/);
  await expect(withAccountContext(data,owner,db=>db.updateTable('daily_recalculation_jobs').set({owner_id:foreign}).execute())).rejects.toThrow();
  for(const table of ['daily_recalculation_cursors','daily_score_snapshots','garmin_credentials','auth_sessions']){
   expect((await sql<{allowed:boolean}>`select has_table_privilege(current_user,${table},'SELECT') as allowed`.execute(dispatch)).rows[0]?.allowed).toBe(false);
  }
  // Older shared-role grants remain behind forced RLS, with no dispatcher policy.
  for(const table of ['daily_metrics','activities','score_ledger','source_records','scoring_rules'])expect(await withAccountContext(dispatch,owner,db=>sql`select * from ${sql.table(table)}`.execute(db))).toMatchObject({rows:[]});
  await expect(withAccountContext(data,owner,db=>db.updateTable('daily_recalculation_jobs').set({to_date:shiftScoringDate(date,1)}).where('id','=',job.id).execute())).rejects.toThrow(/permission denied|target is immutable/);
  await scoped(app,owner,repo=>repo.cancel(job.id));await worker().processNext();
 });
});
