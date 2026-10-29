import {sql,type Kysely,type Selectable} from 'kysely';
import type {Database,Json} from '../schema.js';
import type {GarminJobsTable,GarminJob} from '../garmin-jobs-schema.js';
type Row=Selectable<GarminJobsTable>;
export type GarminTarget={operation:'day';date:string;refresh:boolean}|{operation:'activity';activityId:string;refresh:boolean};
export class GarminQueueError extends Error{constructor(readonly code:'NOT_CONNECTED'|'WORKER_UNAVAILABLE'|'BUSY'|'NOT_FOUND'|'LEASE_LOST'){super(code)}}
const publicJob=(r:Row):GarminJob=>({id:r.id,operation:r.operation,date:r.calendar_date,activityId:r.activity_id,refresh:r.refresh,status:r.status,phase:r.phase,attemptCount:r.attempt_count,errorCode:r.error_code,createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString()});
export class GarminJobsRepository{
 constructor(private db:Kysely<Database>){}
 async capability(){
  const connection=await this.db.selectFrom('garmin_connections').select(['id','status']).executeTakeFirst();
  const worker=await this.db.selectFrom('garmin_worker_status').select('ready').where('ready','=',true).where('checked_at','>',sql<Date>`now()-interval '90 seconds'`).executeTakeFirst();
  return {enabled:connection?.status==='ready'&&!!worker,reason:!connection?'not_connected':connection.status!=='ready'?'reauthorization_required':!worker?'worker_offline':'ready',connectionId:connection?.id??null};
 }
 async active(){const row=await this.db.selectFrom('garmin_jobs').selectAll().where('status','in',['queued','running']).orderBy('created_at','desc').executeTakeFirst();return row?publicJob(row):null}
 async enqueue(target:GarminTarget):Promise<GarminJob>{return this.db.transaction().execute(async tx=>{
  const connection=await tx.selectFrom('garmin_connections').select(['id','status']).forUpdate().executeTakeFirst();
  if(!connection||connection.status!=='ready')throw new GarminQueueError('NOT_CONNECTED');
  if(target.operation==='activity'&&!await tx.selectFrom('activities').select('id').where('id','=',target.activityId).executeTakeFirst())throw new GarminQueueError('NOT_FOUND');
  const active=await tx.selectFrom('garmin_jobs').selectAll().where('connection_id','=',connection.id).where('status','in',['queued','running']).executeTakeFirst();
  if(active){if(active.operation===target.operation&&(target.operation==='day'?String(active.calendar_date)===target.date:active.activity_id===target.activityId)&&active.refresh===target.refresh)return publicJob(active);throw new GarminQueueError('BUSY')}
  if(!(await new GarminJobsRepository(tx).capability()).enabled)throw new GarminQueueError('WORKER_UNAVAILABLE');
  return publicJob(await tx.insertInto('garmin_jobs').values({connection_id:connection.id,operation:target.operation,calendar_date:target.operation==='day'?target.date:null,activity_id:target.operation==='activity'?target.activityId:null,refresh:target.refresh,lease_owner:null,lease_expires_at:null,cancellation_requested_at:null,error_code:null,completed_at:null}).returningAll().executeTakeFirstOrThrow());
 })}
 async get(id:string){const r=await this.db.selectFrom('garmin_jobs').selectAll().where('id','=',id).executeTakeFirst();return r?publicJob(r):null}
 async cancel(id:string){await this.db.updateTable('garmin_jobs').set({cancellation_requested_at:new Date(),updated_at:new Date()}).where('id','=',id).where('status','in',['queued','running']).execute();return this.get(id)}
 async retry(id:string){const r=await this.get(id);if(!r)return null;if(!['failed','cancelled'].includes(r.status))throw new GarminQueueError('BUSY');return this.enqueue(r.operation==='day'?{operation:'day',date:r.date!,refresh:r.refresh}:{operation:'activity',activityId:r.activityId!,refresh:r.refresh})}
 /** Only used with the owner-scoped worker-data role by a trusted operator. */
 async importSession(encrypt:(connectionId:string)=>Json){return this.db.transaction().execute(async tx=>{
  let c=await tx.selectFrom('garmin_connections').selectAll().forUpdate().executeTakeFirst();
  if(c&&await tx.selectFrom('garmin_jobs').select('id').where('connection_id','=',c.id).where('status','in',['queued','running']).executeTakeFirst())throw new GarminQueueError('BUSY');
  if(!c)c=await tx.insertInto('garmin_connections').values({}).returningAll().executeTakeFirstOrThrow();
  const envelope=encrypt(c.id);
  await tx.insertInto('garmin_credentials').values({connection_id:c.id,envelope_json:envelope}).onConflict(oc=>oc.column('connection_id').doUpdateSet({envelope_json:envelope,updated_at:new Date()})).execute();
  await tx.updateTable('garmin_connections').set({status:'ready',revision:sql<number>`revision+1`,updated_at:new Date()}).where('id','=',c.id).execute();
  return c.id;
 })}
 async credential(connectionId:string){return this.db.selectFrom('garmin_connections as c').innerJoin('garmin_credentials as s',j=>j.onRef('c.id','=','s.connection_id').onRef('c.owner_id','=','s.owner_id')).select(['c.revision','c.status','s.envelope_json']).where('c.id','=',connectionId).executeTakeFirst()}
 async rotate(connectionId:string,revision:number,envelope:Json){return this.db.transaction().execute(async tx=>{
  const updated=await tx.updateTable('garmin_connections').set({revision:sql<number>`revision+1`,updated_at:new Date()}).where('id','=',connectionId).where('revision','=',revision).where('status','=','ready').returning('revision').executeTakeFirst();
  if(!updated)throw new GarminQueueError('LEASE_LOST');
  await tx.updateTable('garmin_credentials').set({envelope_json:envelope,updated_at:new Date()}).where('connection_id','=',connectionId).execute();return updated.revision;
 })}
 async requireReconnect(connectionId:string){await this.db.updateTable('garmin_connections').set({status:'reauthorization_required',updated_at:new Date()}).where('id','=',connectionId).execute()}
}
export class GarminDispatchRepository{
 constructor(private db:Kysely<Database>){}
 async heartbeat(worker:string,ready=true){await this.db.insertInto('garmin_worker_status').values({worker_id:worker,ready,checked_at:new Date()}).onConflict(oc=>oc.column('worker_id').doUpdateSet({ready,checked_at:new Date()})).execute();await this.db.deleteFrom('garmin_worker_status').where('checked_at','<',sql<Date>`now()-interval '1 day'`).execute()}
 async claim(worker:string,leaseSeconds=90){return this.db.transaction().execute(async tx=>{
  await tx.updateTable('garmin_jobs').set({status:'cancelled',phase:'cancelled',lease_owner:null,lease_expires_at:null,completed_at:new Date(),updated_at:new Date()}).where('status','=','queued').where('cancellation_requested_at','is not',null).execute();
  await tx.updateTable('garmin_jobs').set({status:'failed',phase:'failed',error_code:'RETRY_EXHAUSTED',lease_owner:null,lease_expires_at:null,completed_at:new Date(),updated_at:new Date()}).where('status','=','running').where('lease_expires_at','<',new Date()).where('attempt_count','>=',3).execute();
  await tx.updateTable('garmin_jobs').set({status:'queued',phase:'recovering',lease_owner:null,lease_expires_at:null,updated_at:new Date()}).where('status','=','running').where('lease_expires_at','<',new Date()).where('attempt_count','<',3).execute();
  const row=await tx.selectFrom('garmin_jobs').selectAll().where('status','=','queued').where('cancellation_requested_at','is',null).where('next_attempt_at','<=',new Date()).orderBy('created_at').forUpdate().skipLocked().executeTakeFirst();
  if(!row)return null;
  return tx.updateTable('garmin_jobs').set({status:'running',phase:'fetching',lease_owner:worker,lease_expires_at:sql<Date>`now()+make_interval(secs=>${leaseSeconds})`,attempt_count:sql<number>`attempt_count+1`,updated_at:new Date(),error_code:null}).where('id','=',row.id).returningAll().executeTakeFirstOrThrow();
 })}
}
export async function assertGarminLease(db:Kysely<Database>,id:string,worker:string,allowCancellation=false){
 const row=await db.selectFrom('garmin_jobs').selectAll().where('id','=',id).where('status','=','running').where('lease_owner','=',worker).where('lease_expires_at','>',sql<Date>`now()`).forUpdate().executeTakeFirst();
 if(!row||(!allowCancellation&&row.cancellation_requested_at))throw new GarminQueueError('LEASE_LOST');return row;
}
