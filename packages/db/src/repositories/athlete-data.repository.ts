import { ACTIVITY_METRIC_CATALOG, ACTIVITY_METRIC_PARSER_VERSION } from '@sportos/domain';
import type { AthleteActivity, Discipline, Supplement } from '@sportos/analytics';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';
import {
  effectiveDistanceExpression,
  hasDistanceCorrectionExpression,
} from './activity-distance-corrections.repository.js';
import { displaySubtype } from './run-classification.js';
import { ActivityMetricsRepository } from './activity-metrics.repository.js';

/** Compact, explicitly selected primary read models; never source bodies or narrative. */
export class AthleteDataRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async activities(input: {
    from?: string;
    to: string;
    activityId?: string;
  }): Promise<AthleteActivity[]> {
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
    const rows = await query.orderBy('activity_date').orderBy('id').limit(50001).execute();
    if (rows.length > 50000) throw Error('ARCHIVE_LIMIT');
    const number = (value: unknown) => (value === null ? null : Number(value));
    return rows.map((r) => ({
      id: r.id,
      date: String(r.activity_date).slice(0, 10),
      discipline: r.activity_type as Discipline,
      subtype: r.subtype,
      source: r.source,
      distanceM: number(r.effective_distance_m),
      recordedDistanceM: number(r.recorded_distance_m),
      distanceCorrected: r.distance_corrected,
      elapsedS: number(r.duration_s),
      movingS: number(r.moving_time_s),
      avgHrBpm: number(r.avg_hr),
      maxHrBpm: number(r.max_hr),
      elevationM: number(r.elevation_gain_m),
      updatedAt: (r.updated_at instanceof Date
        ? r.updated_at
        : new Date(String(r.updated_at))
      ).toISOString(),
      historicalSummary: r.historical_summary,
    }));
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
