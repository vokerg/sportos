import {sql,type Kysely,type Selectable} from 'kysely';
import type {Database} from '../schema.js';
import type {DailyRecalculationJobsTable,DailyRecalculationJob,DailyRecalculationState} from '../daily-recalculation-schema.js';
import {inRepositoryTransaction} from '../ownership-context.js';
import {DailyScoringRepository} from './daily-scoring.repository.js';
import {parseDailyScoreBreakdown} from '../score-breakdown-contract.js';

type JobRow=Selectable<DailyRecalculationJobsTable>;
const active=['queued','running'] as const;
export class DailyRecalculationError extends Error {
 constructor(readonly code:'NOT_FOUND'|'NOT_RETRYABLE'|'LEASE_LOST'|'RANGE_TOO_LARGE'|'CURSOR_ALREADY_SET'){super(code)}
}
export function shiftScoringDate(date:string,days:number){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)}
function countDays(from:string,to:string){return Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000)}
function publicJob(row:JobRow):DailyRecalculationJob {
 return {id:row.id,from:row.from_date,to:row.to_date,nextDate:row.next_date,processedDays:countDays(row.from_date,row.next_date),totalDays:countDays(row.from_date,row.to_date)+1,status:row.status,errorCode:row.error_code,attemptCount:row.attempt_count};
}
export class DailyRecalculationRepository {
 constructor(private readonly db:Kysely<Database>){}
 private async calendar(){
  const cursor=await this.db.selectFrom('daily_recalculation_cursors').select(['start_date','completed_through','time_zone']).executeTakeFirst();
  const zone=cursor?.time_zone??(await this.db.selectFrom('garmin_connections').select('time_zone').executeTakeFirst())?.time_zone??'UTC';
  const today=(await sql<{today:string}>`select (clock_timestamp() AT TIME ZONE ${zone})::date::text as today`.execute(this.db)).rows[0]!.today;
  const start=cursor?.start_date??today;
  const next=cursor?.completed_through?shiftScoringDate(cursor.completed_through,1):start;
  return {cursor:{startDate:start,completedThrough:cursor?.completed_through??null,timeZone:zone},today,nextDate:next>today?today:next};
 }
 async state():Promise<DailyRecalculationState>{
  const {cursor,nextDate}=await this.calendar();
  const latest=await this.db.selectFrom('daily_recalculation_jobs').selectAll().orderBy('created_at','desc').orderBy('id','desc').executeTakeFirst();
  const running=await this.db.selectFrom('daily_recalculation_jobs').selectAll().where('status','in',active).executeTakeFirst();
  return {cursor,nextDate,activeJob:running?publicJob(running):null,latestJob:latest?publicJob(latest):null};
 }
 async enqueue():Promise<DailyRecalculationJob>{return inRepositoryTransaction(this.db,async tx=>{
  // Serializes competing requests even before the first cursor row exists.
  await sql`select pg_advisory_xact_lock(hashtextextended('sportos.daily.recalculation:'||sportos_current_account_id()::text,0))`.execute(tx);
  const existing=await tx.selectFrom('daily_recalculation_jobs').selectAll().where('status','in',active).executeTakeFirst();
  if(existing)return publicJob(existing);
  const {cursor,today,nextDate}=await new DailyRecalculationRepository(tx).calendar();
  if(countDays(nextDate,today)>3660)throw new DailyRecalculationError('RANGE_TOO_LARGE');
  await tx.insertInto('daily_recalculation_cursors').values({start_date:cursor.startDate,time_zone:cursor.timeZone}).onConflict(oc=>oc.column('owner_id').doNothing()).execute();
  return publicJob(await tx.insertInto('daily_recalculation_jobs').values({from_date:nextDate,to_date:today,next_date:nextDate,time_zone:cursor.timeZone}).returningAll().executeTakeFirstOrThrow());
 })}
 async get(id:string){const row=await this.db.selectFrom('daily_recalculation_jobs').selectAll().where('id','=',id).executeTakeFirst();return row?publicJob(row):null}
 async cancel(id:string){await this.db.updateTable('daily_recalculation_jobs').set({cancellation_requested_at:new Date(),updated_at:new Date()}).where('id','=',id).where('status','in',active).execute();return this.get(id)}
 async retry(id:string){const job=await this.get(id);if(!job)throw new DailyRecalculationError('NOT_FOUND');if(!['failed','cancelled'].includes(job.status))throw new DailyRecalculationError('NOT_RETRYABLE');return this.enqueue()}
 /** Trusted non-owner operator initialization only; never rewinds an existing cursor. */
 async initialize(startDate:string,timeZone:string){return inRepositoryTransaction(this.db,async tx=>{
  await sql`select pg_advisory_xact_lock(hashtextextended('sportos.daily.recalculation:'||sportos_current_account_id()::text,0))`.execute(tx);
  if(await tx.selectFrom('daily_recalculation_cursors').select('start_date').executeTakeFirst())throw new DailyRecalculationError('CURSOR_ALREADY_SET');
  await tx.insertInto('daily_recalculation_cursors').values({start_date:startDate,time_zone:timeZone}).execute();
 })}
 /** The claim, authoritative score replacement and checkpoint share one transaction. */
 async process(id:string,worker:string,signal?:AbortSignal){return inRepositoryTransaction(this.db,async tx=>{
  const job=await assertLease(tx,id,worker);
  if(job.cancellation_requested_at){await terminal(tx,id,'cancelled',null);return;}
  const cursor=await tx.selectFrom('daily_recalculation_cursors').selectAll().forUpdate().executeTakeFirstOrThrow();
  const expected=cursor.completed_through?shiftScoringDate(cursor.completed_through,1):cursor.start_date;
  if(job.next_date!==expected)throw new DailyRecalculationError('LEASE_LOST');
  const result=await new DailyScoringRepository(tx).recalculateFromActivitiesInTransaction(job.next_date);
  parseDailyScoreBreakdown(result);
  await assertLease(tx,id,worker);
  if(signal?.aborted)throw new DailyRecalculationError('LEASE_LOST');
  const today=(await sql<{today:string}>`select (clock_timestamp() AT TIME ZONE ${job.time_zone})::date::text as today`.execute(tx)).rows[0]!.today;
  // Today receives an official current score, but is never a completed day.
  if(job.next_date<today)await tx.updateTable('daily_recalculation_cursors').set({completed_through:job.next_date,updated_at:new Date()}).execute();
  const more=job.next_date<job.to_date;
  await tx.updateTable('daily_recalculation_jobs').set({next_date:shiftScoringDate(job.next_date,1),status:more?'queued':'succeeded',attempt_count:more?0:job.attempt_count,lease_owner:null,lease_expires_at:null,updated_at:new Date(),completed_at:more?null:new Date()}).where('id','=',id).execute();
 })}
 async fail(id:string,worker:string,code:'DAILY_DATA_UNAVAILABLE'|'DAILY_RECALCULATION_FAILED'){
  return inRepositoryTransaction(this.db,async tx=>{await assertLease(tx,id,worker);await terminal(tx,id,'failed',code)});
 }
}
async function assertLease(db:Kysely<Database>,id:string,worker:string){
 const job=await db.selectFrom('daily_recalculation_jobs').selectAll().where('id','=',id).where('status','=','running').where('lease_owner','=',worker).where('lease_expires_at','>',sql<Date>`clock_timestamp()`).forUpdate().executeTakeFirst();
 if(!job)throw new DailyRecalculationError('LEASE_LOST');return job;
}
async function terminal(db:Kysely<Database>,id:string,status:'failed'|'cancelled',code:string|null){
 await db.updateTable('daily_recalculation_jobs').set({status,error_code:code,lease_owner:null,lease_expires_at:null,updated_at:new Date(),completed_at:new Date()}).where('id','=',id).execute();
}
/** Narrow dispatcher access: queue lifecycle only, never scoring/cursor reads. */
export class DailyRecalculationDispatchRepository {
 constructor(private readonly db:Kysely<Database>){}
 async claim(worker:string){return inRepositoryTransaction(this.db,async tx=>{
  await tx.updateTable('daily_recalculation_jobs').set({status:'cancelled',lease_owner:null,lease_expires_at:null,updated_at:new Date(),completed_at:new Date()}).where('status','=','queued').where('cancellation_requested_at','is not',null).execute();
  await tx.updateTable('daily_recalculation_jobs').set({status:'failed',error_code:'RETRY_EXHAUSTED',lease_owner:null,lease_expires_at:null,updated_at:new Date(),completed_at:new Date()}).where('status','=','running').where('lease_expires_at','<',new Date()).where('attempt_count','>=',3).execute();
  await tx.updateTable('daily_recalculation_jobs').set({status:'queued',lease_owner:null,lease_expires_at:null,updated_at:new Date()}).where('status','=','running').where('lease_expires_at','<',new Date()).where('attempt_count','<',3).execute();
  const row=await tx.selectFrom('daily_recalculation_jobs').selectAll().where('status','=','queued').orderBy('created_at').forUpdate().skipLocked().executeTakeFirst();
  if(!row)return null;
  return tx.updateTable('daily_recalculation_jobs').set({status:'running',attempt_count:sql<number>`attempt_count+1`,lease_owner:worker,lease_expires_at:sql<Date>`now()+interval '90 seconds'`,updated_at:new Date()}).where('id','=',row.id).returning(['id','owner_id']).executeTakeFirstOrThrow();
 })}
}
