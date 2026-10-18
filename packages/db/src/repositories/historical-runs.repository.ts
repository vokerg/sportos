import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';
import { planHistoricalRun, type HistoricalRunDay, type HistoricalRunPlan } from '../historical-run-plan.js';
import { lockActivityReconciliation } from './garmin-activities.repository.js';
export class HistoricalRunsRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async run(input: { from: string; to: string; limit: number; cursor?: string; apply?: boolean }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error('Invalid historical batch limit.');
    for (const date of [input.from, input.to, ...(input.cursor ? [input.cursor] : [])]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) throw new Error('Invalid calendar date.');
    }
    if (input.from > input.to) throw new Error('Invalid historical range.');
    if (!input.apply) return this.execute(input, false);
    return this.db.transaction().execute(async tx => {
      await lockActivityReconciliation(tx);
      return new HistoricalRunsRepository(tx).execute(input, true);
    });
  }
  private async execute(input: {from: string; to: string; limit: number; cursor?: string}, apply: boolean) {
    const days = (await sql<{ date: string }>`with dates as (
      select d.metric_date as date from daily_metrics d where d.run_m>0 and not exists
        (select 1 from activities a where a.activity_date=d.metric_date and a.activity_type='run')
      union select e.event_date from performance_events e where e.source='run_db_xlsx' and e.activity_id is null and not exists
        (select 1 from performance_match_heads h join performance_match_decisions dec on dec.owner_id=h.owner_id and dec.id=h.decision_id
         where h.event_id=e.id and (dec.status in ('accepted','rejected') or dec.method in ('operator','historical')))
    ) select date::text from dates where date between ${input.from}::date and ${input.to}::date
      and (${input.cursor??null}::date is null or date>${input.cursor??null}::date) order by date limit ${input.limit+1}`.execute(this.db)).rows;
    const dates = days.slice(0,input.limit).map(d=>d.date), plans: HistoricalRunPlan[] = [];
    if (!dates.length) return { applied: apply, plans, created: 0, linked: 0, nextCursor: input.cursor ?? null, hasMore: false };
    const daily = await this.db.selectFrom('daily_metrics as d').innerJoin('source_records as s',j=>j.onRef('s.owner_id','=','d.owner_id').onRef('s.id','=','d.source_record_id'))
      .select(['d.metric_date','d.run_m','s.id','s.source','s.raw_json']).where('d.metric_date','in',dates).where('s.source','=','my_sport_xlsx').where('d.run_m','>',0).execute();
    const events = await this.db.selectFrom('performance_events as e').leftJoin('performance_match_heads as h',j=>j.onRef('h.owner_id','=','e.owner_id').onRef('h.event_id','=','e.id'))
      .leftJoin('performance_match_decisions as dec',j=>j.onRef('dec.owner_id','=','h.owner_id').onRef('dec.id','=','h.decision_id'))
      .innerJoin('source_records as s',j=>j.onRef('s.owner_id','=','e.owner_id').onRef('s.id','=','e.source_record_id').on('s.source','=','run_db_xlsx'))
      .select(['e.id','e.event_date','e.distance_m','e.duration_s','e.is_treadmill','e.source_record_id','e.activity_id','dec.status','dec.method'])
      .where('e.source','=','run_db_xlsx').where('e.event_date','in',dates).limit(10001).execute();
    const activities = await this.db.selectFrom('activities').select(['id','activity_date','distance_m','subtype','source','source_record_id'])
      .where('activity_type','=','run').where('activity_date','in',dates).limit(10001).execute();
    if (activities.length > 10000 || events.length > 10000) throw new Error('Historical evidence bound exceeded.');
    let created = 0, linked = 0;
    for (const date of dates) {
      const d = daily.find(d=>d.metric_date===date);
      const day: HistoricalRunDay = { date,
        daily: d ? { distanceM: Number(d.run_m), sourceRecordId: d.id, subtype: dailySubtype(d.raw_json) } : null,
        records: events.filter(e=>e.event_date===date).map(e=>({ id:e.id,date,distanceM:Number(e.distance_m),durationS:e.duration_s,treadmill:e.is_treadmill,
          sourceRecordId:e.source_record_id,locked:!!e.activity_id || e.status==='accepted' || e.status==='rejected' || e.method==='operator' || e.method==='historical' })),
        activities: activities.filter(a=>a.activity_date===date).map(a=>({id:a.id,distanceM:a.distance_m===null?null:Number(a.distance_m),subtype:a.subtype,source:a.source_record_id ? a.source : 'manual'})) };
      const plan = planHistoricalRun(day); plans.push(plan);
      if (!apply) continue;
      let newId: string | null = null;
      if (plan.create) {
        const c = plan.create;
        const metadata = { policyVersion: 1, basis: c.basis, timingEventId: c.timingEventId, sessionCount: 'unknown', timingBasis: 'historical_unspecified' };
        const activity = await this.db.insertInto('activities').values({source:c.source,source_record_id:c.sourceRecordId,
          source_activity_id:`historical-run-summary-v1:${date}`,source_record_hash:hash({kind:'historical-run-summary-v1',date}),
          activity_type:'run',activity_date:date,subtype:c.subtype as 'unknown'|'treadmill'|'outdoor',start_time:null,distance_m:c.distanceM,
          duration_s:c.durationS,moving_time_s:null,avg_pace_s_per_km:c.durationS===null?null:c.durationS*1000/c.distanceM,
          notes:'Historical Excel reconstruction: daily run summary, not an individual GPS recording. Session count and timing basis are unknown.',
          raw_payload_json:{historicalReconstruction:metadata} }).returning('id').executeTakeFirstOrThrow();
        newId = activity.id; created++;
      }
      for (const link of plan.links) {
        const activityId = link.activityId ?? newId;
        if (!activityId) throw new Error('Historical activity missing.');
        const evidence = {activityId,eventId:link.eventId,date,policyVersion:1,basis:plan.create?.basis??'existing_workbook_activity'};
        const decision = await this.db.insertInto('performance_match_decisions').values({event_id:link.eventId,activity_id:activityId,status:'accepted',method:'historical',
          policy_version:1,input_hash:hash(evidence),reason:'historical_excel_reconstruction',diagnostics:[evidence] as Json}).returning('id').executeTakeFirstOrThrow();
        await this.db.insertInto('performance_match_heads').values({event_id:link.eventId,decision_id:decision.id})
          .onConflict(oc=>oc.columns(['owner_id','event_id']).doUpdateSet({decision_id:decision.id})).execute();
        linked++;
      }
    }
    return { applied: apply, plans, created, linked, nextCursor: dates.at(-1)!, hasMore: days.length>input.limit };
  }
}
const hash = (v:unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function dailySubtype(raw: Json): string {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return 'unknown';
  const headers=raw.headers,cells=raw.cells;
  if (!Array.isArray(headers) || !Array.isArray(cells)) return 'unknown';
  const get = (name:string) => { const i=headers.findIndex(h=>typeof h==='string' && h.toLowerCase().replace(/\s+/g,'')===name); return i<0?0:Number(cells[i]??0); };
  const inside=get('rin'),outside=get('rout');
  return inside>0 && outside===0 ? 'treadmill' : outside>0 && inside===0 ? 'outdoor' : 'unknown';
}
