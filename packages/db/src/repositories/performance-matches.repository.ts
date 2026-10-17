import { createHash } from 'node:crypto';
import { RUNNING_EFFORT_TARGETS, matchHistoricalPerformance, performanceTarget, type HistoricalRecord, type HistoricalWorkoutCandidate, type PerformanceMatch } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';
import { lockActivityReconciliation } from './garmin-activities.repository.js';
import { validateMetricBackfillOptions, type MetricBackfillOptions } from '../activity-metric-backfill.js';

interface BatchInspection {
  record: HistoricalRecord; existingActivityId: string | null; result: PerformanceMatch;
  previous: {status:'accepted'|'ambiguous'|'unmatched'|'rejected';method:'automatic'|'operator';inputHash:string} | null;
}
export class PerformanceMatchesRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async inspect(eventId: string) {
    const row = await this.db.selectFrom('performance_events').select(['id','event_date','distance_m','duration_s','is_treadmill','activity_id'])
      .where('source','=','run_db_xlsx').where('id','=',eventId).executeTakeFirst();
    if (!row) return null;
    const record: HistoricalRecord = { id:row.id,date:date(row.event_date),distanceM:Number(row.distance_m),durationS:Number(row.duration_s),treadmill:row.is_treadmill };
    // Adjacent days are exposed for review, never accepted without operator evidence.
    const candidates = (await sql<HistoricalWorkoutCandidate>`select a.id, a.activity_date::text as date, a.distance_m::float8 as "distanceM",
      a.moving_time_s::float8 as "movingTimeS", a.subtype from activities a
      where a.activity_type='run' and a.activity_date between ${record.date}::date-1 and ${record.date}::date+1
      and exists (select 1 from provider_activity_links l join provider_connections c on c.owner_id=l.owner_id and c.id=l.connection_id
        join source_records s on s.owner_id=l.owner_id and s.id=l.latest_source_record_id
        where l.owner_id=a.owner_id and l.activity_id=a.id and l.availability='available' and c.provider='strava' and s.source='strava_api')
      order by a.id limit 101`.execute(this.db)).rows;
    if (candidates.length > 100) throw new Error('Candidate bound exceeded; narrow operator review is required.');
    const storedDecision=await this.db.selectFrom('performance_match_heads as h')
      .innerJoin('performance_match_decisions as d',j=>j.onRef('d.owner_id','=','h.owner_id').onRef('d.id','=','h.decision_id'))
      .select(['d.status','d.method','d.activity_id as activityId','d.policy_version as policyVersion','d.reason'])
      .where('h.event_id','=',eventId).executeTakeFirst();
    return { record, existingActivityId:row.activity_id, storedDecision:storedDecision??null, result:matchHistoricalPerformance(record,candidates) };
  }
  /** Automatic replay never changes an accepted or explicitly rejected decision. */
  async reconcile(eventId: string, dryRun = true, override?: { activityId: string | null }) {
    if (dryRun) return this.inspect(eventId);
    return this.db.transaction().execute(async tx => {
      await lockActivityReconciliation(tx);
      const repo = new PerformanceMatchesRepository(tx), inspection = await repo.inspect(eventId);
      if (!inspection || !performanceTarget(inspection.record.distanceM)) return inspection;
      const previous = await tx.selectFrom('performance_match_heads as h').innerJoin('performance_match_decisions as d',j=>j.onRef('d.owner_id','=','h.owner_id').onRef('d.id','=','h.decision_id'))
        .select(['d.status','d.method','d.input_hash']).where('h.event_id','=',eventId).executeTakeFirst();
      if (!override && (previous?.status==='accepted' || previous?.method==='operator')) return inspection;
      let result = inspection.result;
      if (!override && inspection.existingActivityId && result.activityId !== inspection.existingActivityId)
        result={...result,status:'ambiguous',activityId:null,reason:'existing_activity_link_conflict'};
      if (override) {
        // Explicit operator review may resolve date/pace uncertainty, but not foreign/non-run/non-Strava identifiers.
        if (override.activityId && !result.candidates.some(c=>c.id===override.activityId)) throw new Error('Reviewed candidate unavailable.');
        result={...result,activityId:override.activityId,status:override.activityId?'accepted':'unmatched',reason:override.activityId?'operator_confirmed':'operator_rejected'};
      }
      const method = override ? 'operator' as const : 'automatic' as const;
      const inputHash = decisionHash(inspection.record,result,method);
      if (previous?.input_hash===inputHash) return {...inspection,result};
      const decision = await tx.insertInto('performance_match_decisions').values({event_id:eventId,activity_id:result.activityId,
        status:override && !override.activityId ? 'rejected' : result.status,method,policy_version:result.version,input_hash:inputHash,
        reason:result.reason,diagnostics:sql<Json>`${JSON.stringify(result.candidates)}::jsonb`}).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('performance_match_heads').values({event_id:eventId,decision_id:decision.id})
        .onConflict(oc=>oc.columns(['owner_id','event_id']).doUpdateSet({decision_id:decision.id})).execute();
      return {...inspection,result};
    });
  }
  async batch(options: MetricBackfillOptions) {
    validateMetricBackfillOptions(options);
    let query=this.db.selectFrom('performance_events').select('id').where('source','=','run_db_xlsx').where('distance_m','in',[...RUNNING_EFFORT_TARGETS,21100]).orderBy('id');
    if(options.cursor) query=query.where('id','>',options.cursor);
    const rows=await query.limit(options.limit+1).execute(), batch=rows.slice(0,options.limit);
    const run=async(db:Kysely<Database>)=>{
      const counts={accepted:0,ambiguous:0,unmatched:0,rejected:0};
      const inspections=await new PerformanceMatchesRepository(db).inspectBatch(batch.map(r=>r.id));
      const writes=[];
      for(const inspection of inspections){
        const {previous,record}=inspection;
        if(previous&&(previous.status==='accepted'||previous.method==='operator')){counts[previous.status]++;continue;}
        const result=inspection.existingActivityId&&inspection.result.activityId!==inspection.existingActivityId
          ? {...inspection.result,status:'ambiguous' as const,activityId:null,reason:'existing_activity_link_conflict'} : inspection.result;
        counts[result.status]++;
        const inputHash=decisionHash(record,result,'automatic');
        if(!options.dryRun&&previous?.inputHash!==inputHash)writes.push({event_id:record.id,activity_id:result.activityId,status:result.status,
          method:'automatic' as const,policy_version:result.version,input_hash:inputHash,reason:result.reason,diagnostics:sql<Json>`${JSON.stringify(result.candidates)}::jsonb`});
      }
      if(writes.length){
        const decisions=await db.insertInto('performance_match_decisions').values(writes).returning(['id','event_id']).execute();
        await db.insertInto('performance_match_heads').values(decisions.map(d=>({event_id:d.event_id,decision_id:d.id})))
          .onConflict(oc=>oc.columns(['owner_id','event_id']).doUpdateSet({decision_id:sql`excluded.decision_id`})).execute();
      }
      return counts;
    };
    const counts=options.dryRun?await run(this.db):await this.db.transaction().execute(async tx=>{await lockActivityReconciliation(tx);return run(tx);});
    return {dryRun:options.dryRun,processed:batch.length,counts,nextCursor:batch.at(-1)?.id??options.cursor??null,hasMore:rows.length>options.limit};
  }
  /** One compact statement for a bounded batch, avoiding thousands of remote
   * round trips. Apply inspects and publishes under one reconciliation lock.
   */
  private async inspectBatch(ids:string[]):Promise<BatchInspection[]>{
    if(!ids.length)return [];if(ids.length>100)throw new Error('Inspection batch exceeds limit.');
    const rows=(await sql<{id:string;date:string;distanceM:number;durationS:number;treadmill:boolean;activityId:string|null;
      status:'accepted'|'ambiguous'|'unmatched'|'rejected'|null;
      method:'automatic'|'operator'|null;inputHash:string|null;candidates:HistoricalWorkoutCandidate[]}>`
      select e.id,e.event_date::text as date,e.distance_m::float8 as "distanceM",e.duration_s as "durationS",e.is_treadmill as treadmill,e.activity_id as "activityId",
        d.status,d.method,d.input_hash as "inputHash",
        coalesce((select jsonb_agg(candidate order by candidate.id) from (
          select a.id,a.activity_date::text as date,a.distance_m::float8 as "distanceM",a.moving_time_s::float8 as "movingTimeS",a.subtype
          from activities a where a.activity_type='run' and a.activity_date between e.event_date-1 and e.event_date+1
          and exists(select 1 from provider_activity_links l join provider_connections c on c.owner_id=l.owner_id and c.id=l.connection_id
            join source_records source on source.owner_id=l.owner_id and source.id=l.latest_source_record_id
            where l.owner_id=a.owner_id and l.activity_id=a.id and l.availability='available' and c.provider='strava' and source.source='strava_api')
          order by a.id limit 101) candidate),'[]'::jsonb) as candidates
      from performance_events e left join performance_match_heads h on h.owner_id=e.owner_id and h.event_id=e.id
        left join performance_match_decisions d on d.owner_id=h.owner_id and d.id=h.decision_id
      where e.source='run_db_xlsx' and e.id in (${sql.join(ids.map(id=>sql`${id}::uuid`))}) order by e.id`.execute(this.db)).rows;
    return rows.map(row=>{
      if(row.candidates.length>100)throw new Error('Candidate bound exceeded; narrow operator review is required.');
      const record:HistoricalRecord={id:row.id,date:row.date,distanceM:row.distanceM,durationS:row.durationS,treadmill:row.treadmill};
      return {record,existingActivityId:row.activityId,result:matchHistoricalPerformance(record,row.candidates),
        previous:row.status&&row.method&&row.inputHash?{status:row.status,method:row.method,inputHash:row.inputHash}:null};
    });

  }
}
function date(value: unknown): string { return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10); }

function decisionHash(record:HistoricalRecord,result:PerformanceMatch,method:'automatic'|'operator'){
  const candidates=result.candidates.map(c=>({id:c.id,date:c.date,distanceM:c.distanceM,movingTimeS:c.movingTimeS,subtype:c.subtype,
    paceSPerKm:c.paceSPerKm,score:c.score,reason:c.reason}));
  return createHash('sha256').update(JSON.stringify({record,result:{status:result.status,activityId:result.activityId,version:result.version,reason:result.reason,candidates},method})).digest('hex');
}
