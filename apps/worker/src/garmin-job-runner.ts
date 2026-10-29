import {AsyncLocalStorage} from 'node:async_hooks';
import {spawn,spawnSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {access} from 'node:fs/promises';
import {GarminDispatchRepository,GarminJobsRepository,GarminQueueError,assertGarminLease,withAccountContext,sql,type Database,type Kysely,type Json} from '@sportos/db';
import {GarminSessionCipher,type GarminSession,type CredentialEnvelope,type UploadStorage} from '@sportos/importers';
import {ActivityEnrichmentService,ActivityRouteProjectionService,GarminDayService,type AccountDatabase} from '@sportos/garmin-runtime';
import {runPollingLoop} from './polling-loop.js';

type Claim=NonNullable<Awaited<ReturnType<GarminDispatchRepository['claim']>>>;
export interface GarminBridge {call(request:object,session:GarminSession,signal:AbortSignal,persist:(session:unknown)=>Promise<void>,timeZone?:string):Promise<unknown>}
export class PythonGarminBridge implements GarminBridge{
 constructor(private python=process.env.SPORTOS_GARMIN_PYTHON?.trim()||join(homedir(),'.local/share/sportos/garmin/venv/bin/python')){}
 async check(){
  await access(this.python);
  const result=spawnSync(this.python,['-c','from importlib.metadata import version; assert version("garminconnect")=="0.3.17"; import garminconnect, fitdecode'],{stdio:'ignore',timeout:10000});
  if(result.status!==0)throw new Error('The pinned Garmin helper environment is unavailable; run garmin:setup.');
 }
 call(request:object,session:GarminSession,signal:AbortSignal,persist:(session:unknown)=>Promise<void>,timeZone?:string):Promise<unknown>{
  if(signal.aborted)return Promise.reject(new GarminQueueError('LEASE_LOST'));
  return new Promise((resolve,reject)=>{
   const child=spawn(this.python,[fileURLToPath(new URL('../../../tools/garmin/worker_bridge.py',import.meta.url))],{stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG,PYTHONDONTWRITEBYTECODE:'1',TZ:timeZone??'UTC'}});
   let output='',settled=false;
   const finish=(error?:unknown,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value)};
   const abort=()=>{child.kill('SIGKILL');finish(new GarminQueueError('LEASE_LOST'))};
   const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('GARMIN_FETCH_TIMEOUT'))},180000);
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
   child.stdout.on('data',chunk=>{output+=String(chunk);if(Buffer.byteLength(output)>262144){child.kill('SIGKILL');finish(new Error('GARMIN_RESPONSE_INVALID'))}});
   child.once('error',()=>finish(new Error('GARMIN_HELPER_UNAVAILABLE')));
   child.once('close',code=>{void(async()=>{
    if(settled)return;
    try{const response=JSON.parse(output) as {session?:unknown;error?:string;result?:unknown};output='';if(response.session)await persist(response.session);
     if(response.error||code!==0){const known=['GARMIN_RATE_LIMITED_RETRY_LATER','GARMIN_ACCESS_DENIED_REAUTHENTICATE','GARMIN_LOGIN_FAILED_REAUTHENTICATE','GARMIN_LOGIN_OR_FETCH_FAILED'];throw new Error(known.includes(response.error??'')?response.error:'GARMIN_FETCH_FAILED')}
     finish(undefined,response.result);
    }catch(error){finish(error)}
   })()});
   child.stdin.on('error',()=>undefined);child.stdin.end(JSON.stringify({request,session}));
  });
 }
}
export class GarminJobRunner{
 constructor(private dispatch:Kysely<Database>,private data:Kysely<Database>,private detail:Kysely<Database>,private storage:UploadStorage,private cipher:GarminSessionCipher,private workerId:string,private bridge:GarminBridge=new PythonGarminBridge()){}
 async run(signal:AbortSignal){
  const discovery=new GarminDispatchRepository(this.dispatch);
  if(this.bridge instanceof PythonGarminBridge)await this.bridge.check();
  await discovery.heartbeat(this.workerId);
  const timer=setInterval(()=>{void discovery.heartbeat(this.workerId).catch(()=>undefined)},20000);
  try{await runPollingLoop(async()=>{const job=await discovery.claim(this.workerId);if(!job)return false;await this.process(job,signal);return true},1000,signal)}
  finally{clearInterval(timer);await discovery.heartbeat(this.workerId,false)}
 }
 async process(job:Claim,shutdown=new AbortController().signal){
  const controller=new AbortController();const abort=()=>controller.abort();shutdown.addEventListener('abort',abort,{once:true});if(shutdown.aborted)abort();
  // Every primary write and every detail operation holds the primary lease row
  // lock until that transaction commits. A stale worker cannot publish results.
  const fence=new AsyncLocalStorage<Kysely<Database>>();
  const context=(pool:Kysely<Database>):AccountDatabase=>({withAccount:async<T>(owner:string,fn:(db:Kysely<Database>)=>Promise<T>)=>{
   if(owner!==job.owner_id||controller.signal.aborted)throw new GarminQueueError('LEASE_LOST');
   const current=fence.getStore();
   if(current)return pool===this.data?fn(current):withAccountContext(pool,owner,fn);
   return withAccountContext(this.data,owner,db=>db.transaction().execute(async tx=>{
    await assertGarminLease(tx,job.id,this.workerId);
    const result=await fence.run(tx,()=>pool===this.data?fn(tx):withAccountContext(pool,owner,fn));
    await assertGarminLease(tx,job.id,this.workerId);return result;
   }));
  }});
  const primary=context(this.data),detail=context(this.detail);
  const storage:UploadStorage={
   store:input=>primary.withAccount(job.owner_id,()=>this.storage.store(input)),
   read:key=>primary.withAccount(job.owner_id,()=>this.storage.read(key)),
   delete:key=>primary.withAccount(job.owner_id,()=>this.storage.delete(key)),
  };
  const heartbeat=setInterval(()=>{void withAccountContext(this.data,job.owner_id,db=>db.transaction().execute(async tx=>{
   await assertGarminLease(tx,job.id,this.workerId);await tx.updateTable('garmin_jobs').set({lease_expires_at:sql<Date>`now()+interval '90 seconds'`,updated_at:new Date()}).where('id','=',job.id).execute();
  })).catch(()=>controller.abort())},15000);
  let stage='credentials';
  try{
   let credentials=await primary.withAccount(job.owner_id,db=>new GarminJobsRepository(db).credential(job.connection_id));
   if(!credentials||credentials.status!=='ready')throw new Error('GARMIN_REAUTHORIZATION_REQUIRED');
   let session=this.cipher.decrypt(job.owner_id,job.connection_id,credentials.envelope_json as unknown as CredentialEnvelope);
   let revision=credentials.revision;
   const persist=async(raw:unknown)=>{const envelope=this.cipher.encrypt(job.owner_id,job.connection_id,raw);revision=await primary.withAccount(job.owner_id,db=>new GarminJobsRepository(db).rotate(job.connection_id,revision,envelope as unknown as Json));session=this.cipher.decrypt(job.owner_id,job.connection_id,envelope)};
   const routes=new ActivityRouteProjectionService(primary,detail);
   class Enrichment extends ActivityEnrichmentService{
    override localEnabled(owner:string){return owner===job.owner_id}
    override bridge(request:object,signal?:AbortSignal){return runner.bridge.call(request,session,signal??controller.signal,persist,credentials!.time_zone)}
   }
   const runner=this;
   const enrichment=new Enrichment(primary,detail,storage,{isDevelopmentMode:()=>false},{status:async()=>({})},undefined,undefined,routes);
   stage='execution';
   const result=job.operation==='day'?await new GarminDayService(primary,detail,storage,enrichment,credentials.time_zone).fetch({id:job.owner_id},job.calendar_date!,job.refresh,controller.signal):await enrichment.fetch({id:job.owner_id},job.activity_id!,job.refresh);
   const categories=(result as {categories?:Array<{state:string}>}).categories??[];
   if(categories.some(c=>c.state==='authentication_required'))throw new Error('GARMIN_REAUTHORIZATION_REQUIRED');
   if(categories.some(c=>c.state==='rate_limited'))throw new Error('GARMIN_RATE_LIMITED_RETRY_LATER');
   if(categories.some(c=>c.state==='failed'))throw new Error('GARMIN_PARTIAL_FAILURE');
   stage='completion';
   await this.finish(job,'succeeded',null);
  }catch(error){
   const raw=error instanceof Error?error.message:'';
   const response=error&&typeof error==='object'&&'getResponse' in error?(error as {getResponse():unknown}).getResponse():null;
   const code=response&&typeof response==='object'&&'code' in response?String(response.code):raw;
   console.error('Garmin worker operation failed',{stage,type:error instanceof Error?error.name:'unknown',code:/^[A-Z_0-9]{1,80}$/.test(code)?code:'UNCLASSIFIED'});
   const auth=/REAUTH|LOGIN|SESSION|credential envelope/.test(code),rate=/RATE_LIMIT/.test(code);
   try{
    if(auth)await primary.withAccount(job.owner_id,db=>new GarminJobsRepository(db).requireReconnect(job.connection_id));
    await this.finish(job,controller.signal.aborted?'queued':rate?'queued':'failed',controller.signal.aborted?'GARMIN_WORKER_INTERRUPTED':auth?'GARMIN_REAUTHORIZATION_REQUIRED':rate?'GARMIN_RATE_LIMITED':code==='GARMIN_PARTIAL_FAILURE'?code:'GARMIN_FETCH_FAILED',rate);
   }catch{ /* Lease was superseded or database unavailable; durable recovery owns it. */ }
  }finally{clearInterval(heartbeat);shutdown.removeEventListener('abort',abort);controller.abort()}
 }
 private finish(job:Claim,status:'succeeded'|'failed'|'cancelled'|'queued',code:string|null,rate=false){return withAccountContext(this.data,job.owner_id,db=>db.transaction().execute(async tx=>{
  const current=await assertGarminLease(tx,job.id,this.workerId,true);
  if(current.cancellation_requested_at)status='cancelled';
  await tx.updateTable('garmin_jobs').set({status,phase:status==='queued'?(rate?'rate_limited':'queued'):status,error_code:code,lease_owner:null,lease_expires_at:null,attempt_count:rate||code==='GARMIN_WORKER_INTERRUPTED'?Math.max(current.attempt_count-1,0):current.attempt_count,next_attempt_at:rate?sql<Date>`now()+interval '15 minutes'`:status==='queued'?sql<Date>`now()+interval '5 seconds'`:new Date(),completed_at:status==='queued'?null:new Date(),updated_at:new Date()}).where('id','=',job.id).execute();
 }))}
}
