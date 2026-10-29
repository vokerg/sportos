import { ACTIVITY_METRIC_CATALOG, ACTIVITY_METRIC_PARSER_VERSION } from '@sportos/domain';
import {
  aggregate,
  calendarBucketRanges,
  type AthleteActivity,
  type Discipline,
  type Supplement,
} from '@sportos/analytics';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';
import {
  effectiveDistanceExpression,
  hasDistanceCorrectionExpression,
} from './activity-distance-corrections.repository.js';
import { displaySubtype } from './run-classification.js';
import { ActivityMetricsRepository } from './activity-metrics.repository.js';

export interface AthleteSearchQuery {
  from?: string;
  to: string;
  activityId?: string;
  discipline?: Discipline;
  source?:
    | 'manual'
    | 'my_sport_xlsx'
    | 'run_db_xlsx'
    | 'google_sheets'
    | 'strava'
    | 'garmin'
    | 'fit';
  subtype?: 'outdoor' | 'indoor' | 'treadmill' | 'track' | 'manual' | 'race' | 'unknown';
  minDistanceM?: number;
  maxDistanceM?: number;
  minDurationS?: number;
  maxDurationS?: number;
  maxPaceSPerKm?: number;
  minSpeedKmh?: number;
  qualifiedWholeActivity?: boolean;
}
function serializeActivity(r: Record<string, unknown>): AthleteActivity {
  const number = (v: unknown) => (v === null ? null : Number(v));
  return {
    id: String(r.id),
    date: String(r.activity_date).slice(0, 10),
    discipline: r.activity_type as Discipline,
    subtype: r.subtype as string | null,
    source: String(r.source),
    distanceM: number(r.effective_distance_m),
    recordedDistanceM: number(r.recorded_distance_m),
    distanceCorrected: r.distance_corrected as boolean,
    elapsedS: number(r.duration_s),
    movingS: number(r.moving_time_s),
    avgHrBpm: number(r.avg_hr),
    maxHrBpm: number(r.max_hr),
    elevationM: number(r.elevation_gain_m),
    updatedAt: (r.updated_at instanceof Date
      ? r.updated_at
      : new Date(String(r.updated_at))
    ).toISOString(),
    historicalSummary: r.historical_summary as boolean,
  };
}
/** Compact, explicitly selected primary read models; never source bodies or narrative. */
export class AthleteDataRepository {
  constructor(private readonly db: Kysely<Database>) {}
  private query(input: AthleteSearchQuery) {
    let query = this.db
      .selectFrom('activities')
      .select([
        'id',
        'activity_date',
        'activity_type',
        'source',
        'duration_s',
        'moving_time_s',
        'avg_hr',
        'max_hr',
        'elevation_gain_m',
        'updated_at',
        'distance_m as recorded_distance_m',
      ])
      .select([
        effectiveDistanceExpression('activities').as('effective_distance_m'),
        hasDistanceCorrectionExpression('activities').as('distance_corrected'),
        displaySubtype('activities').as('subtype'),
        sql<boolean>`coalesce(raw_payload_json->'historicalReconstruction'->>'policyVersion'='1',false)`.as(
          'historical_summary',
        ),
      ])
      .where('activity_type', 'in', ['run', 'bike', 'swim'])
      .where('activity_date', '<=', input.to);
    if (input.from) query = query.where('activity_date', '>=', input.from);
    if (input.activityId) query = query.where('id', '=', input.activityId);
    const distance = effectiveDistanceExpression('activities');
    const duration = sql<
      number | null
    >`case when moving_time_s>0 then moving_time_s when duration_s>0 then duration_s else null end`;
    const pace = sql<number | null>`${duration}/nullif(${distance}/1000.0,0)`;
    if (input.discipline) query = query.where('activity_type', '=', input.discipline);
    if (input.source) query = query.where('source', '=', input.source);
    if (input.subtype) query = query.where(displaySubtype('activities'), '=', input.subtype);
    if (input.minDistanceM !== undefined) query = query.where(distance, '>=', input.minDistanceM);
    if (input.maxDistanceM !== undefined) query = query.where(distance, '<=', input.maxDistanceM);
    if (input.minDurationS !== undefined)
      query = query.where('duration_s', '>=', input.minDurationS);
    if (input.maxDurationS !== undefined)
      query = query.where('duration_s', '<=', input.maxDurationS);
    if (input.maxPaceSPerKm !== undefined)
      query = query.where(distance, '>', 0).where(pace, '<=', input.maxPaceSPerKm);
    if (input.minSpeedKmh !== undefined)
      query = query
        .where(distance, '>', 0)
        .where(sql<number>`3600.0/${pace}`, '>=', input.minSpeedKmh);
    if (input.qualifiedWholeActivity)
      query = query
        .where(distance, '>', 0)
        .where('duration_s', '>', 0)
        .where(
          sql<boolean>`not coalesce(raw_payload_json->'historicalReconstruction'->>'policyVersion'='1',false)`,
        );
    return query;
  }
  async activities(input: AthleteSearchQuery): Promise<AthleteActivity[]> {
    const rows = await this.query(input)
      .orderBy('activity_date')
      .orderBy('id')
      .limit(50001)
      .execute();
    if (rows.length > 50000) throw Error('ARCHIVE_LIMIT');
    return rows.map(serializeActivity);
  }
  async totals(input: AthleteSearchQuery) {
    const distance = effectiveDistanceExpression('activities');
    const row = await this.query(input)
      .clearSelect()
      .select((eb) => [
        eb.fn.countAll<number>().as('sessions'),
        sql<number | null>`sum(${distance})::float8`.as('distanceM'),
        sql<number | null>`sum(moving_time_s)::float8`.as('movingS'),
        sql<number | null>`sum(duration_s)::float8`.as('elapsedS'),
        sql<number>`count(${distance})::int`.as('distanceKnown'),
        sql<number>`count(moving_time_s)::int`.as('movingKnown'),
        sql<number>`count(duration_s)::int`.as('elapsedKnown'),
        sql<number>`count(distinct activity_date)::int`.as('activeDays'),
      ])
      .executeTakeFirstOrThrow();
    const calendarDays = input.from
      ? Math.round((Date.parse(input.to) - Date.parse(input.from)) / 86400000) + 1
      : null;
    return {
      ...row,
      sessions: Number(row.sessions),
      calendarDays,
      sessionsPerWeek: calendarDays
        ? Math.round(((Number(row.sessions) * 7) / calendarDays) * 1000) / 1000
        : null,
    };
  }
  async search(
    input: AthleteSearchQuery & {
      limit: number;
      offset: number;
      sort?: 'recent' | 'elapsed' | 'pace';
    },
  ) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isInteger(input.offset) ||
      input.offset < 0 ||
      input.offset > 50000
    )
      throw Error('Invalid athlete page.');
    const query = this.query(input),
      distance = effectiveDistanceExpression('activities');
    const order =
      input.sort === 'elapsed'
        ? query.orderBy('duration_s')
        : input.sort === 'pace'
          ? query.orderBy(
              sql`case when moving_time_s>0 then moving_time_s else duration_s end/nullif(${distance}/1000.0,0)`,
            )
          : query.orderBy('activity_date', 'desc');
    const [rows, totals] = await Promise.all([
      order.orderBy('id').limit(input.limit).offset(input.offset).execute(),
      this.totals(input),
    ]);
    return {
      items: rows.map(serializeActivity),
      total: totals.sessions,
      totals,
      limit: input.limit,
      offset: input.offset,
    };
  }
  async volume(
    input: AthleteSearchQuery & {
      from: string;
      period: 'daily' | 'weekly' | 'monthly' | 'annual';
      limit: number;
      offset: number;
    },
  ) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isInteger(input.offset) ||
      input.offset < 0 ||
      input.offset > 50000
    )
      throw Error('Invalid volume page.');
    const ranges = calendarBucketRanges(input.from, input.to, input.period),
      page = ranges.slice(input.offset, input.offset + input.limit),
      totals = await this.totals(input);
    if (!page.length)
      return {
        buckets: [],
        total: ranges.length,
        totals,
        limit: input.limit,
        offset: input.offset,
      };
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', annual: 'year' }[input.period];
    const query = this.query({ ...input, from: page[0].from, to: page.at(-1)!.to });
    const result = await sql<Record<string, unknown>>`with base as (${query}), b as (
      select base.*,date_trunc(${unit},activity_date)::date::text as bucket,
       case when moving_time_s>0 then moving_time_s when duration_s>0 then duration_s else null end as paired_time
      from base
    ) select bucket,activity_type,count(*)::int as sessions,count(distinct activity_date)::int as "activeDays",
      sum(effective_distance_m) filter(where effective_distance_m>=0)::float8 as "distanceM",
      sum(moving_time_s) filter(where moving_time_s>=0)::float8 as "movingS",sum(duration_s) filter(where duration_s>=0)::float8 as "elapsedS",
      count(*) filter(where effective_distance_m>=0)::int as "distanceKnown",count(*) filter(where moving_time_s>=0)::int as "movingKnown",count(*) filter(where duration_s>=0)::int as "elapsedKnown",
      avg(moving_time_s) filter(where moving_time_s>=0)::float8 as "averageSessionMovingS",
      percentile_cont(0.5) within group(order by moving_time_s) filter(where moving_time_s>=0)::float8 as "medianSessionMovingS",
      avg(effective_distance_m) filter(where effective_distance_m>=0)::float8 as "averageSessionDistanceM",
      percentile_cont(0.5) within group(order by effective_distance_m) filter(where effective_distance_m>=0)::float8 as "medianSessionDistanceM",
      avg(paired_time/nullif(effective_distance_m/1000.0,0)) filter(where effective_distance_m>0 and paired_time>0)::float8 as "meanSessionPaceSPerKm",
      percentile_cont(0.5) within group(order by paired_time/nullif(effective_distance_m/1000.0,0)) filter(where effective_distance_m>0 and paired_time>0)::float8 as "medianSessionPaceSPerKm",
      (sum(paired_time) filter(where effective_distance_m>0 and paired_time>0)/nullif(sum(effective_distance_m/1000.0) filter(where effective_distance_m>0 and paired_time>0),0))::float8 as "weightedPaceSPerKm",
      count(*) filter(where effective_distance_m>0 and paired_time>0)::int as "pacePairedSessions",
      count(*) filter(where effective_distance_m>0 and paired_time>0 and moving_time_s>0)::int as "paceMovingSessions",
      count(*) filter(where effective_distance_m>0 and paired_time>0 and not coalesce(moving_time_s>0,false))::int as "paceElapsedFallbackSessions",
      avg(avg_hr) filter(where avg_hr>0)::float8 as "meanRecordedHrBpm",count(*) filter(where avg_hr>0)::int as "hrKnown",
      sum(elevation_gain_m)::float8 as "elevationM",count(elevation_gain_m)::int as "elevationKnown",
      count(*) filter(where distance_corrected)::int as "correctedSessions",count(*) filter(where historical_summary)::int as "historicalSummarySessions",
      (select jsonb_object_agg(source,n) from (select source,count(*)::int n from b b2 where b2.bucket=b.bucket and b2.activity_type=b.activity_type group by source) sources) as "sourceCounts",
      (select jsonb_object_agg(subtype,n) from (select coalesce(subtype,'unknown') subtype,count(*)::int n from b b2 where b2.bucket=b.bucket and b2.activity_type=b.activity_type group by coalesce(subtype,'unknown')) subtypes) as "subtypeCounts"
      from b group by bucket,activity_type order by bucket,activity_type`.execute(this.db);
    const buckets = page.map((range) => ({
      key: range.key,
      partial: range.partial,
      disciplines: Object.fromEntries(
        (['run', 'bike', 'swim'] as const).map((sport) => {
          const empty = aggregate([], range.from, range.to),
            row = result.rows.find((r) => r.bucket === range.key && r.activity_type === sport);
          if (!row) return [sport, empty];
          const values = Object.fromEntries(
            Object.keys(empty)
              .filter((key) => !['from', 'to', 'calendarDays', 'sessionsPerWeek'].includes(key))
              .map((key) => [
                key,
                row[key] === null
                  ? null
                  : typeof row[key] === 'number'
                    ? Math.round(row[key] * 1000) / 1000
                    : row[key],
              ]),
          );
          return [
            sport,
            {
              ...empty,
              ...values,
              sessionsPerWeek:
                Math.round(((Number(row.sessions) * 7) / empty.calendarDays) * 1000) / 1000,
            },
          ];
        }),
      ),
    }));
    return { buckets, total: ranges.length, totals, limit: input.limit, offset: input.offset };
  }
  async supplements(
    from: string | undefined,
    to: string,
    activityId?: string,
  ): Promise<Supplement[]> {
    // The same projection/source/parser freshness contract as ActivityMetricsRepository.comparisons.
    // Canonical fields remain authoritative; numeric extras never create new workouts.
    const result = await sql<{
      activity_id: string;
      provider: 'strava' | 'garmin';
      metric_key: string;
      value: number;
      unit: string;
      origin: string;
      source_kind: string;
      canonical_present: boolean;
      projected_at: Date;
      precedence: number;
    }>`
      select v.activity_id,v.provider,v.metric_key,v.value::float8,v.unit,v.origin,v.source_kind,p.projected_at,v.precedence,
        case v.metric_key when 'average_heart_rate' then a.avg_hr is not null when 'maximum_heart_rate' then a.max_hr is not null when 'ascent' then a.elevation_gain_m is not null when 'calories' then a.calories is not null else false end as canonical_present
      from activity_provider_metric_values v
      join activity_metric_heads h on h.owner_id=v.owner_id and h.activity_id=v.activity_id and h.provider=v.provider and h.projection_id=v.projection_id
      join activity_metric_projections p on p.owner_id=h.owner_id and p.id=h.projection_id
      join activities a on a.owner_id=v.owner_id and a.id=v.activity_id
      where a.activity_type in ('run','bike','swim') and a.activity_date<=${to}::date
        and (${from ?? null}::date is null or a.activity_date>=${from ?? null}::date)
        and (${activityId ?? null}::uuid is null or a.id=${activityId ?? null}::uuid)
        and h.state in ('processed','partial') and p.state in ('processed','partial')
        and h.source_ref=p.source_ref and h.source_version=p.source_version
        and (h.expected_input_hash is null or h.expected_input_hash=p.input_hash)
        and p.parser_version=${ACTIVITY_METRIC_PARSER_VERSION}
        and ((v.provider='strava' and exists (
          select 1 from provider_activity_links l
          join provider_connections c on c.owner_id=l.owner_id and c.id=l.connection_id
          join source_records s on s.owner_id=l.owner_id and s.id=l.latest_source_record_id
          where l.owner_id=a.owner_id and l.activity_id=a.id and l.id=h.source_ref and s.row_hash=h.source_version
            and c.provider='strava' and s.source='strava_api' and l.availability='available'
            and l.id=(select l2.id from provider_activity_links l2 join provider_connections c2 on c2.owner_id=l2.owner_id and c2.id=l2.connection_id where l2.owner_id=a.owner_id and l2.activity_id=a.id and l2.availability='available' and c2.provider='strava' order by l2.updated_at desc,l2.id desc limit 1)))
          or (v.provider='garmin' and exists (select 1 from garmin_activity_identities g where g.owner_id=a.owner_id and g.activity_id=a.id and g.id=h.source_ref and g.current_hash=h.source_version)))
      order by a.activity_date,a.id,v.metric_key,v.provider,v.precedence desc,v.source_field
      limit 1000001`.execute(this.db);
    if (result.rows.length > 1000000) throw Error('METRIC_LIMIT');
    const grouped = new Map<string, typeof result.rows>();
    for (const r of result.rows) {
      const key = `${r.activity_id}:${r.metric_key}`;
      const list = grouped.get(key) ?? [];
      list.push(r);
      grouped.set(key, list);
    }
    const selected: Supplement[] = [];
    for (const rows of grouped.values()) {
      const definition = ACTIVITY_METRIC_CATALOG.find((d) => d.key === rows[0].metric_key);
      if (!definition) continue;
      if (
        definition.canonicalColumn &&
        (!['average_heart_rate', 'maximum_heart_rate', 'ascent', 'calories'].includes(
          definition.key,
        ) ||
          rows[0].canonical_present)
      )
        continue;
      const preference = definition.priority ?? ['strava', 'garmin'];
      const row = preference
        .flatMap((provider) => rows.filter((r) => r.provider === provider))
        .find(
          (r) =>
            Number.isFinite(Number(r.value)) &&
            Number(r.value) >= definition.min &&
            Number(r.value) <= definition.max &&
            r.unit === definition.unit,
        );
      if (row)
        selected.push({
          activityId: row.activity_id,
          provider: row.provider,
          key: row.metric_key,
          value: Number(row.value),
          unit: row.unit,
          origin: row.origin,
          sourceKind: row.source_kind,
          method: row.origin === 'recorded' ? 'measured' : 'calculated',
          projectedAt: new Date(row.projected_at).toISOString(),
        });
    }
    return selected;
  }
  async providerFreshness() {
    const rows = await this.db
      .selectFrom('provider_connections')
      .select(['provider', 'status', 'last_sync_at', 'last_attempt_at'])
      .orderBy('provider')
      .execute();
    const timestamp = (v: unknown) =>
      v === null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();
    return rows.map((r) => ({
      provider: r.provider,
      status: r.status,
      lastSyncAt: timestamp(r.last_sync_at),
      lastAttemptAt: timestamp(r.last_attempt_at),
    }));
  }
  async garminReference(activityId: string) {
    return this.db
      .selectFrom('garmin_activity_identities')
      .select(['identity_key', 'current_hash'])
      .where('activity_id', '=', activityId)
      .executeTakeFirst();
  }
  async details(activityId: string, to: string) {
    const activity = (await this.activities({ activityId, to }))[0];
    if (!activity) return null;
    const statuses = await new ActivityMetricsRepository(this.db).statuses([activityId]);
    return {
      activity,
      supplements: await this.supplements(undefined, to, activityId),
      providerCoverage: (statuses[activityId] ?? []).map((s) => ({
        provider: s.provider,
        state: s.state,
        lastProjectedAt: s.lastProjectedAt,
        missingCount: s.missingCount,
        rejectedCount: s.rejectedCount,
      })),
    };
  }
}
