import { RUNNING_EFFORT_TARGETS, runningEffortDistanceTolerance } from '@sportos/domain';
import {sql,type Kysely} from 'kysely';
import type {Database} from './schema.js';
import type {DetailExecutor} from './activity-metric-projector.js';
import {validateMetricBackfillOptions,type MetricBackfillOptions} from './activity-metric-backfill.js';
import {ActivityProviderResourcesRepository} from './repositories/activity-provider-resources.repository.js';
import {RunningEffortsRepository} from './repositories/running-efforts.repository.js';
export type CatchupCategory='already_current'|'retained_stale'|'retained_unprocessed'|'needs_rich_fetch'|'unavailable'|'failed';
export interface CatchupOptions extends MetricBackfillOptions {through:string;from?:string;}
export interface CatchupCandidate {activityId:string;targets:number[];category:CatchupCategory;action:'skip'|'reprocess'|'fetch';}
/** Metadata-only plan. The union is by canonical UUID, so every run is fetched at most once per scan.
 * Targets without Excel cutoffs are computed opportunistically for selected runs;
 * a separate explicit from-date is required to scan their older history.
 */
export async function previewPerformanceCatchup(primary:Kysely<Database>,detail:DetailExecutor,options:CatchupOptions){
 validateMetricBackfillOptions(options);
 for(const date of [options.through,options.from].filter(Boolean))if(!validDate(date!))throw new Error('Invalid catch-up date.');
 if(options.from&&options.from>options.through)throw new Error('Invalid catch-up range.');
 const cutoffs=(await sql<{target:number;last:string}>`select (case when distance_m=21100 then 21097.5 else distance_m end)::float8 as target,max(event_date)::text as last
   from performance_events where source='run_db_xlsx' and (case when distance_m=21100 then 21097.5 else distance_m end) in (${sql.join(RUNNING_EFFORT_TARGETS)}) group by 1 order by 1`.execute(primary)).rows;
 const unanchoredTargets=RUNNING_EFFORT_TARGETS.filter(t=>!cutoffs.some(c=>c.target===t));
 if(!cutoffs.length&&!options.from)return {unanchoredTargets,blocked:'no_excel_cutoffs' as const,cutoffs,rows:[] as CatchupCandidate[],nextCursor:options.cursor??null,hasMore:false};
 const targets=sql.join(RUNNING_EFFORT_TARGETS.map(t=>sql`(${t}::float8,${cutoffs.find(c=>c.target===t)?.last??null}::date,${runningEffortDistanceTolerance(t)}::float8)`));
 const rows=(await sql<{activityId:string;targets:number[]}>`with targets(target,cutoff,tolerance) as (values ${targets})
   select a.id as "activityId",array_agg(t.target order by t.target) as targets from activities a cross join targets t
   where a.activity_type='run' and a.distance_m>=t.target-t.tolerance
     and a.activity_date<=${options.through}::date
     and (${options.from??null}::date is null or a.activity_date>=${options.from??null}::date)
     and ((t.cutoff is not null and a.activity_date>t.cutoff) or (t.cutoff is null and ${options.from??null}::date is not null))
     and (${options.cursor??null}::uuid is null or a.id>${options.cursor??null}::uuid)
     and exists(select 1 from provider_activity_links l join provider_connections c on c.owner_id=l.owner_id and c.id=l.connection_id
       join source_records s on s.owner_id=l.owner_id and s.id=l.latest_source_record_id and s.source='strava_api'
       where l.owner_id=a.owner_id and l.activity_id=a.id and l.availability='available' and c.provider='strava')
   group by a.id order by a.id limit ${options.limit+1}`.execute(primary)).rows;
 const plan:CatchupCandidate[]=[];
 for(const row of rows.slice(0,options.limit)){
  const ref=await new ActivityProviderResourcesRepository(primary).getProviderReference(row.activityId);
  if(!ref)continue;
  const metadata=await detail(d=>new ActivityProviderResourcesRepository(d).metadata(ref));
  const stream=metadata.find(m=>m.resourceType==='streams'&&m.providerVersion===ref.providerVersion);
  const read=await new RunningEffortsRepository(primary).read(row.activityId),provider=read?.providers.find(p=>p.provider==='strava');
  const current=provider?.state==='current'&&row.targets.every(t=>provider.efforts.some(e=>e.targetDistanceM===t&&e.status==='calculated'));
  const retained=stream?.availability==='available';
  const terminalUnavailable=provider?.state==='current'&&row.targets.some(t=>provider.efforts.some(e=>e.targetDistanceM===t&&e.status!=='calculated'))&&retained;
  const category:CatchupCategory=current?'already_current':terminalUnavailable?'unavailable':provider?.state==='failed'?'failed':retained?provider?.state==='stale'?'retained_stale':'retained_unprocessed':stream?.availability==='unavailable'?'unavailable':'needs_rich_fetch';
  plan.push({activityId:row.activityId,targets:row.targets,category,action:current||category==='unavailable'?'skip':retained?'reprocess':'fetch'});
 }
 return {unanchoredTargets,blocked:null,cutoffs,rows:plan,nextCursor:rows.slice(0,options.limit).at(-1)?.activityId??options.cursor??null,hasMore:rows.length>options.limit};
}
function validDate(s:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(`${s}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
