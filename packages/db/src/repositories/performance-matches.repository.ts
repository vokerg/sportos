import { createHash } from 'node:crypto';
import { matchHistoricalPerformance, performanceTarget, type HistoricalRecord, type HistoricalWorkoutCandidate } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';
import { lockActivityReconciliation } from './garmin-activities.repository.js';
import { validateMetricBackfillOptions, type MetricBackfillOptions } from '../activity-metric-backfill.js';

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
    return { record, existingActivityId:row.activity_id, result:matchHistoricalPerformance(record,candidates) };
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
      const inputHash = createHash('sha256').update(JSON.stringify({record:inspection.record,result,method})).digest('hex');
      if (previous?.input_hash===inputHash) return {...inspection,result};
      const decision = await tx.insertInto('performance_match_decisions').values({event_id:eventId,activity_id:result.activityId,
        status:override && !override.activityId ? 'rejected' : result.status,method,policy_version:result.version,input_hash:inputHash,
        reason:result.reason,diagnostics:result.candidates as unknown as Json}).returning('id').executeTakeFirstOrThrow();
      await tx.insertInto('performance_match_heads').values({event_id:eventId,decision_id:decision.id})
        .onConflict(oc=>oc.columns(['owner_id','event_id']).doUpdateSet({decision_id:decision.id})).execute();
      return {...inspection,result};
    });
  }
  async batch(options: MetricBackfillOptions) {
    validateMetricBackfillOptions(options);
    let query=this.db.selectFrom('performance_events').select('id').where('source','=','run_db_xlsx').where('distance_m','in',[5000,10000,15000,20000,21100,21097.5,25000,42195]).orderBy('id');
    if(options.cursor) query=query.where('id','>',options.cursor);
    const rows=await query.limit(options.limit+1).execute(), batch=rows.slice(0,options.limit);
    const counts={accepted:0,ambiguous:0,unmatched:0};
    for(const row of batch) { const inspection=await this.reconcile(row.id,options.dryRun); if(inspection)counts[inspection.result.status]++; }
    return {dryRun:options.dryRun,processed:batch.length,counts,nextCursor:batch.at(-1)?.id??options.cursor??null,hasMore:rows.length>options.limit};
  }
}
function date(value: unknown): string { return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10); }
