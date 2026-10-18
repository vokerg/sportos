import { RUNNING_EFFORT_ALGORITHM_VERSION, RUNNING_EFFORT_TARGETS, performanceTarget, runningEffortDistanceTolerance } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';
export interface DistanceLeaderboardRow {
  id: string; activityId: string | null; eventId: string | null; date: string; durationS: number; rank: number;
  source: 'excel' | 'strava' | 'garmin'; reason: string | null; pausePolicy: string; alternativeCount: number;
  alternatives: { source: string; durationS: number; eventId: string | null; reason: string | null }[];
}
export interface DistanceLeaderboard {
  targets: readonly number[]; targetDistanceM: number; total: number; limit: number; offset: number; rows: DistanceLeaderboardRow[];
  coverage: { eligibleRuns: number; measuredCurrent: number; legacyLinked: number; legacyUnmatched: number; legacyAmbiguous: number;
    estimatedOnly: number; missingRichDetail: number; unprocessed: number; staleOrFailed: number; unavailable: number };
}
/** Primary compact reads only. GET cannot fetch, reproject or mutate any evidence. */
export class DistanceLeaderboardRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async read(input: { distanceM: number; from?: string; to?: string; limit: number; offset?: number }): Promise<DistanceLeaderboard> {
    const offset=input.offset??0;
    if (!Number.isInteger(input.limit)||input.limit<1||input.limit>200||!Number.isInteger(offset)||offset<0||offset>100000) throw new Error('Invalid leaderboard page.');
    const target=performanceTarget(input.distanceM);
    if (!target) throw new Error('Unsupported leaderboard target.');
    const data=(await sql<{rows:DistanceLeaderboardRow[];total:number;coverage:DistanceLeaderboard['coverage']}>`
      with runs as (
        select a.* from activities a where a.activity_type='run'
          and (${input.from??null}::date is null or a.activity_date>=${input.from??null}::date)
          and (${input.to??null}::date is null or a.activity_date<=${input.to??null}::date)
      ), refs as (
        select a.id as activity_id,'strava'::text as provider,l.id as source_ref,s.row_hash as source_version
        from runs a cross join lateral (
          select l.id,l.latest_source_record_id from provider_activity_links l
          join provider_connections c on c.owner_id=l.owner_id and c.id=l.connection_id
          join source_records sr on sr.owner_id=l.owner_id and sr.id=l.latest_source_record_id and sr.source='strava_api'
          where l.owner_id=a.owner_id and l.activity_id=a.id and l.availability='available' and c.provider='strava'
          order by l.updated_at desc,l.id desc limit 1
        ) l join source_records s on s.id=l.latest_source_record_id and s.owner_id=a.owner_id
        union all
        select a.id,'garmin',g.id,g.current_hash from runs a join garmin_activity_identities g on g.owner_id=a.owner_id and g.activity_id=a.id
      ), evidence as (
        select r.activity_id,r.provider,v.duration_s,v.reason,v.pause_policy,v.status,
          case when h.activity_id is null then 'unprocessed'
            when h.state='failed' then 'failed'
            when h.state<>'current' or h.source_ref<>r.source_ref or h.source_version<>r.source_version
              or p.source_ref<>r.source_ref or p.source_version<>r.source_version
              or p.algorithm_version<>${RUNNING_EFFORT_ALGORITHM_VERSION} or p.id is null
              or (h.expected_resource_hash is not null and h.expected_resource_hash is distinct from p.resource_hash) then 'stale'
            else 'current' end as state
        from refs r left join running_effort_heads h on h.activity_id=r.activity_id and h.provider=r.provider and h.owner_id=sportos_current_account_id()
        left join running_effort_projections p on p.id=h.projection_id and p.owner_id=h.owner_id
        left join running_effort_values v on v.projection_id=p.id and v.owner_id=p.owner_id and v.target_distance_m=${target}
      ), measured as (
        select a.id::text||':'||e.provider as id,a.id as activity_id,null::uuid as event_id,a.activity_date as date,e.duration_s,e.provider as source,e.reason,e.pause_policy
        from evidence e join runs a on a.id=e.activity_id
        where e.state='current' and e.status='calculated' and e.duration_s>0
      ), legacy as (
        select e.id::text as id,case when d.status='accepted' then d.activity_id when h.event_id is null then e.activity_id else null end as activity_id,
          e.id as event_id,e.event_date as date,e.duration_s::float8 as duration_s,'excel'::text as source,null::text as reason,'historical_excel'::text as pause_policy
        from performance_events e left join performance_match_heads h on h.owner_id=e.owner_id and h.event_id=e.id
        left join performance_match_decisions d on d.owner_id=h.owner_id and d.id=h.decision_id
        where e.source='run_db_xlsx' and (case when e.distance_m=21100 then 21097.5 else e.distance_m end)=${target}
          and (${input.from??null}::date is null or e.event_date>=${input.from??null}::date)
          and (${input.to??null}::date is null or e.event_date<=${input.to??null}::date)
      ), combined as (
        select * from legacy union all select * from measured
      ), grouped as (
        select *,coalesce('activity:'||activity_id::text,'event:'||id) as occurrence,
          row_number() over(partition by coalesce('activity:'||activity_id::text,'event:'||id) order by
            case source when 'excel' then 0 when 'strava' then 1 else 2 end,duration_s,date,id) as preference
        from combined
      ), ranked as (
        select *,row_number() over(order by duration_s,date,id) as rank from grouped where preference=1
      ), limited as (select * from ranked order by rank limit ${input.limit} offset ${offset}), eligible as (
        select a.id from runs a where (a.distance_m>=${target-runningEffortDistanceTolerance(target)} or exists(select 1 from measured m where m.activity_id=a.id))
          and exists(select 1 from refs r where r.activity_id=a.id)
      )
      select coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'activityId',r.activity_id,'eventId',r.event_id,'date',r.date,
        'durationS',r.duration_s,'rank',r.rank,'source',r.source,'reason',r.reason,'pausePolicy',r.pause_policy,
        'alternativeCount',(select count(*) from grouped g where g.occurrence=r.occurrence and g.id<>r.id),
        'alternatives',coalesce((select jsonb_agg(jsonb_build_object('source',g.source,'durationS',g.duration_s,'eventId',g.event_id,'reason',g.reason) order by g.preference)
          from (select g.* from grouped g where g.occurrence=r.occurrence and g.id<>r.id order by g.preference limit 20) g),'[]'::jsonb)) order by r.rank) from limited r),'[]'::jsonb) as rows,
        (select count(*)::int from ranked) as total,
        jsonb_build_object(
          'eligibleRuns',(select count(*) from eligible),
          'measuredCurrent',(select count(distinct activity_id) from measured),
          'legacyLinked',(select count(*) from legacy where activity_id is not null),
          'legacyUnmatched',(select count(*) from legacy where activity_id is null),
          'legacyAmbiguous',(select count(*) from performance_match_heads h join performance_match_decisions d on d.owner_id=h.owner_id and d.id=h.decision_id join legacy l on l.event_id=h.event_id where d.status='ambiguous'),
          'estimatedOnly',(select count(distinct e.activity_id) from evidence e join eligible a on a.id=e.activity_id where e.state='current' and e.status='estimated' and not exists(select 1 from measured m where m.activity_id=e.activity_id)),
          'missingRichDetail',(select count(distinct e.activity_id) from evidence e join eligible a on a.id=e.activity_id where e.provider='strava' and e.state='current' and e.status='estimated' and e.reason='streams_not_retained'),
          'unprocessed',(select count(*) from eligible a where not exists(select 1 from evidence e where e.activity_id=a.id and e.state<>'unprocessed')),
          'staleOrFailed',(select count(distinct e.activity_id) from evidence e join eligible a on a.id=e.activity_id where e.state in ('stale','failed')),
          'unavailable',(select count(distinct e.activity_id) from evidence e join eligible a on a.id=e.activity_id where e.state='current' and e.status='unavailable' and not exists(select 1 from measured m where m.activity_id=e.activity_id))
        ) as coverage`.execute(this.db)).rows[0]!;
    return {targets:[...RUNNING_EFFORT_TARGETS],targetDistanceM:target,limit:input.limit,offset,...data};
  }
}
