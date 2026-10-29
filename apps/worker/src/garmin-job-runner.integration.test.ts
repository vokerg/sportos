import {createHash,randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {createDb,GarminJobsRepository,GarminDispatchRepository,withAccountContext,sql,type Database,type Kysely,type Json} from '@sportos/db';
import {GarminDayService} from '@sportos/garmin-runtime';
import {GarminSessionCipher,type CredentialEnvelope} from '@sportos/importers';
import {GarminJobRunner,type GarminBridge} from './garmin-job-runner.js';
const urls={app:process.env.SPORTOS_GARMIN_TEST_APP_URL,data:process.env.SPORTOS_GARMIN_TEST_DATA_URL,dispatch:process.env.SPORTOS_GARMIN_TEST_DISPATCH_URL,detail:process.env.SPORTOS_GARMIN_TEST_DETAIL_URL};
const integration=Object.values(urls).every(Boolean)?describe:describe.skip;
integration('Garmin queue through non-owner API, dispatcher and worker-data roles',()=>{
 let app:Kysely<Database>,data:Kysely<Database>,dispatch:Kysely<Database>,detail:Kysely<Database>,owner:string,other:string,connection:string;
 const session={di_token:'synthetic-access',di_refresh_token:'synthetic-refresh',di_client_id:'synthetic-client'};
 const cipher=new GarminSessionCipher({activeKeyId:'v1',keys:new Map([['v1',Buffer.alloc(32,1)]])});
 const scoped=<T>(pool:Kysely<Database>,account:string,fn:(repo:GarminJobsRepository)=>Promise<T>)=>withAccountContext(pool,account,db=>fn(new GarminJobsRepository(db)));
 const discovery=()=>new GarminDispatchRepository(dispatch);
 const runner=(id:string,bridge:GarminBridge)=>new GarminJobRunner(dispatch,data,detail,{} as never,cipher,id,bridge);
 beforeAll(async()=>{
  for(const url of Object.values(urls))if(new URL(url!).hostname!=='127.0.0.1')throw new Error('Disposable loopback databases required');
  app=createDb(urls.app!);data=createDb(urls.data!);dispatch=createDb(urls.dispatch!);detail=createDb(urls.detail!);
  for(const pool of [app,data,dispatch,detail]){const result=await sql<{rolsuper:boolean;rolbypassrls:boolean}>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(pool);expect(result.rows[0]).toEqual({rolsuper:false,rolbypassrls:false})}
  owner=(await app.insertInto('accounts').values({display_name:'Synthetic queued Garmin',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
  other=(await app.insertInto('accounts').values({display_name:'Synthetic foreign Garmin',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
  connection=await scoped(data,owner,repo=>repo.importSession(id=>cipher.encrypt(owner,id,session) as unknown as Json,'Europe/Copenhagen'));
  await discovery().heartbeat('test-worker');
 });
 afterEach(()=>vi.restoreAllMocks());afterAll(async()=>{await Promise.all([app?.destroy(),data?.destroy(),dispatch?.destroy(),detail?.destroy()])});
 it('enqueues once, retains evidence before publication, rotates credentials, and converges a repeated date without official writes',async()=>{
  const payload={calendarDate:'2026-03-29',totalSteps:100};const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  vi.spyOn(GarminDayService.prototype,'localPayload').mockResolvedValue(payload);
  const call=vi.fn(async(request:object,_session:unknown,_signal:AbortSignal,persist:(v:unknown)=>Promise<void>)=>{
   await persist({...session,di_token:'synthetic-rotated'});
   const input=request as {date:string;categories:string[]};return {schema:'sportos.garmin-day.v1',date:input.date,categories:input.categories.map(category=>category==='summary'?{category,state:'available',sourceHash:hash,byteSize:100}:{category,state:'unsupported'})};
  });
  const official=()=>withAccountContext(app,owner,async db=>({daily:await db.selectFrom('daily_metrics').selectAll().execute(),ledger:await db.selectFrom('score_ledger').selectAll().execute(),snapshots:await db.selectFrom('daily_score_snapshots').selectAll().execute(),activities:await db.selectFrom('activities').selectAll().execute()}));
  const before=await official();
  const target={operation:'day' as const,date:'2026-03-29',refresh:true};
  const first=await scoped(app,owner,repo=>repo.enqueue(target));const duplicate=await scoped(app,owner,repo=>repo.enqueue(target));expect(duplicate.id).toBe(first.id);
  await expect(scoped(app,owner,repo=>repo.enqueue({...target,date:'2026-03-28'}))).rejects.toMatchObject({code:'BUSY'});
  expect(await scoped(app,other,repo=>repo.get(first.id))).toBe(null);
  const claim=await discovery().claim('worker-one');expect(claim?.id).toBe(first.id);await runner('worker-one',{call}).process(claim!);
  expect(await scoped(app,owner,repo=>repo.get(first.id))).toMatchObject({status:'succeeded'});
  const second=await scoped(app,owner,repo=>repo.enqueue(target));expect(second.id).not.toBe(first.id);const claim2=await discovery().claim('worker-one');await runner('worker-one',{call}).process(claim2!);
  expect(await scoped(app,owner,repo=>repo.get(second.id))).toMatchObject({status:'succeeded'});
  expect(await withAccountContext(app,owner,db=>db.selectFrom('garmin_day_versions').select('id').execute())).toHaveLength(1);
  expect(await withAccountContext(detail,owner,db=>db.selectFrom('garmin_day_resources').select('category').execute())).toHaveLength(1);
  expect(await withAccountContext(detail,other,db=>db.selectFrom('garmin_day_resources').select('category').execute())).toHaveLength(0);
  const credentials=await scoped(data,owner,repo=>repo.credential(connection));expect(cipher.decrypt(owner,connection,credentials!.envelope_json as unknown as CredentialEnvelope).di_token).toBe('synthetic-rotated');
  expect(await scoped(data,other,repo=>repo.credential(connection))).toBeUndefined();expect(await official()).toEqual(before);
 });
 it('denies API/dispatcher credential reads and dispatcher primary/detail source access',async()=>{
  await expect(app.selectFrom('garmin_credentials').selectAll().execute()).rejects.toThrow(/permission denied/);
  for(const table of ['garmin_credentials','garmin_connections','garmin_day_versions','garmin_activity_identities'] as const)await expect(dispatch.selectFrom(table).selectAll().execute()).rejects.toThrow(/permission denied/);
  for(const table of ['activities','score_ledger'] as const)expect(await withAccountContext(dispatch,owner,db=>db.selectFrom(table).selectAll().execute())).toEqual([]);
  expect(await scoped(app,owner,repo=>repo.capability())).toMatchObject({enabled:true,timeZone:'Europe/Copenhagen'});
 });
 it('does not execute a cancelled job or let a superseded lease publish evidence',async()=>{
  const call=vi.fn();const target={operation:'day' as const,date:'2026-03-28',refresh:true};
  const cancelled=await scoped(app,owner,repo=>repo.enqueue(target));const claim=await discovery().claim('cancel-worker');await scoped(app,owner,repo=>repo.cancel(cancelled.id));await runner('cancel-worker',{call}).process(claim!);
  expect(call).not.toHaveBeenCalled();expect(await scoped(app,owner,repo=>repo.get(cancelled.id))).toMatchObject({status:'cancelled'});
  const next=await scoped(app,owner,repo=>repo.enqueue(target));const stale=await discovery().claim('old-worker');
  await dispatch.updateTable('garmin_jobs').set({lease_expires_at:new Date(0)}).where('id','=',next.id).execute();
  const renewed=await discovery().claim('new-worker');expect(renewed?.id).toBe(next.id);await runner('old-worker',{call}).process(stale!);expect(call).not.toHaveBeenCalled();
  await scoped(app,owner,repo=>repo.cancel(next.id));await runner('new-worker',{call}).process(renewed!);
 });
 it('rejects malformed encrypted envelopes and immutable target reassignment',async()=>{
  await expect(withAccountContext(data,owner,db=>db.updateTable('garmin_credentials').set({envelope_json:{keyId:'v1',nonce:'a'.repeat(16),authenticationTag:'a'.repeat(22)+'==',ciphertext:'aaaa'}}).where('connection_id','=',connection).execute())).rejects.toThrow();
  const row=await scoped(app,owner,repo=>repo.enqueue({operation:'day',date:'2026-03-26',refresh:true}));
  await expect(withAccountContext(data,owner,db=>db.updateTable('garmin_jobs').set({calendar_date:'2026-03-25'}).where('id','=',row.id).execute())).rejects.toThrow('immutable');
  await scoped(app,owner,repo=>repo.cancel(row.id));await discovery().claim('cleanup');
 });
 it('requeues an interrupted worker operation instead of losing the request',async()=>{
  const row=await scoped(app,owner,repo=>repo.enqueue({operation:'day',date:'2026-03-25',refresh:true}));const claim=await discovery().claim('interrupt-worker');const controller=new AbortController();
  await runner('interrupt-worker',{call:async()=>{controller.abort();throw new Error('Cancelled')}}).process(claim!,controller.signal);
  expect(await scoped(app,owner,repo=>repo.get(row.id))).toMatchObject({status:'queued',attemptCount:0,errorCode:'GARMIN_WORKER_INTERRUPTED'});
  await scoped(app,owner,repo=>repo.cancel(row.id));await discovery().claim('cleanup');
 });
 it('durably reschedules rate limits without retry consumption and rejects foreign activity identifiers',async()=>{
  const target={operation:'day' as const,date:'2026-03-27',refresh:true};const queued=await scoped(app,owner,repo=>repo.enqueue(target));const claim=await discovery().claim('rate-worker');
  await runner('rate-worker',{call:async()=>{throw new Error('GARMIN_RATE_LIMITED_RETRY_LATER')}}).process(claim!);
  expect(await scoped(app,owner,repo=>repo.get(queued.id))).toMatchObject({status:'queued',phase:'rate_limited',attemptCount:0});
  await scoped(app,owner,repo=>repo.cancel(queued.id));await discovery().claim('rate-worker');
  await expect(scoped(app,owner,repo=>repo.enqueue({operation:'activity',activityId:randomUUID(),refresh:true}))).rejects.toMatchObject({code:'NOT_FOUND'});
 });
});

// The runner/role checks above use synthetic sessions and never contact Garmin.
