import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';
import type { ActivityProviderReference } from './activity-provider-resources.repository.js';
export interface Lap {
  index: number;
  distanceM: number | null;
  elapsedS: number | null;
  movingS: number | null;
  timerS: number | null;
  avgHrBpm: number | null;
}
export interface Laps {
  status: string;
  provider: 'strava' | 'garmin' | null;
  items: Lap[];
  truncated: boolean;
}
export const unavailableLaps = (status: string): Laps => ({
  status,
  provider: null,
  items: [],
  truncated: false,
});
const number = (v: unknown, max = 1000000) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
export function fitLap(fields: unknown, index: number): Lap {
  const row: Lap = {
    index,
    distanceM: null,
    elapsedS: null,
    movingS: null,
    timerS: null,
    avgHrBpm: null,
  };
  if (!Array.isArray(fields)) return row;
  const read = (name: string, unit: string, max: number) => {
    const candidates = fields.filter(
      (f) => f && typeof f === 'object' && f.name === name && f.developerIndex == null,
    );
    return candidates.length === 1 && candidates[0].units === unit
      ? number(candidates[0].value, max)
      : null;
  };
  return {
    ...row,
    distanceM: read('total_distance', 'm', 1000000),
    elapsedS: read('total_elapsed_time', 's', 604800),
    timerS: read('total_timer_time', 's', 604800),
    avgHrBpm: read('avg_heart_rate', 'bpm', 255),
  };
}
/** Explicit detail read only. Project fixed numeric fields in SQL, never raw provider bodies. */
export async function retainedLaps(
  detail: Kysely<Database>,
  activityId: string,
  ref: ActivityProviderReference | null,
  garmin: { identity_key: string; current_hash: string } | undefined,
): Promise<Laps> {
  if (ref) {
    const resource = await detail
      .selectFrom('activity_provider_resources')
      .select(['availability', 'provider_version'])
      .where('activity_id', '=', activityId)
      .where('provider', '=', 'strava')
      .where('provider_activity_id', '=', ref.providerActivityId)
      .where('resource_type', '=', 'laps')
      .executeTakeFirst();
    if (
      resource?.availability === 'available' &&
      resource.provider_version === ref.providerVersion
    ) {
      const rows = (
        await sql<{
          distance: unknown;
          elapsed: unknown;
          moving: unknown;
          hr: unknown;
        }>`select value->'distance' as distance,value->'elapsed_time' as elapsed,value->'moving_time' as moving,value->'average_heartrate' as hr
        from activity_provider_resources r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.payload_json)='array' then r.payload_json else '[]'::jsonb end) with ordinality as lap(value,position)
        where r.activity_id=${activityId}::uuid and r.provider='strava' and r.provider_activity_id=${ref.providerActivityId} and r.resource_type='laps' and r.provider_version=${ref.providerVersion}
        order by position limit 101`.execute(detail)
      ).rows;
      if (rows.length)
        return {
          status: 'retained_current',
          provider: 'strava',
          items: rows.slice(0, 100).map((r, index) => ({
            index,
            distanceM: number(r.distance),
            elapsedS: number(r.elapsed, 604800),
            movingS: number(r.moving, 604800),
            timerS: null,
            avgHrBpm: number(r.hr, 255),
          })),
          truncated: rows.length > 100,
        };
    }
  }
  if (garmin) {
    const rows = (
      await sql<{
        fields: unknown;
      }>`select (select coalesce(jsonb_agg(jsonb_build_object('name',field->'name','value',field->'value','units',field->'units','developerIndex',field->'developerIndex')),'[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(value->'fields')='array' then value->'fields' else '[]'::jsonb end) as field
      where field->>'name' in ('total_distance','total_elapsed_time','total_timer_time','avg_heart_rate')) as fields
      from garmin_activity_resources r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.payload_json)='array' then r.payload_json else '[]'::jsonb end) with ordinality as m(value,position)
      where r.identity_key=${garmin.identity_key} and r.source_hash=${garmin.current_hash} and r.resource_type='records' and value->>'message'='lap'
      order by r.chunk_index,position limit 101`.execute(detail)
    ).rows;
    if (rows.length)
      return {
        status: 'retained_current',
        provider: 'garmin',
        items: rows.slice(0, 100).map((r, index) => fitLap(r.fields, index)),
        truncated: rows.length > 100,
      };
  }
  return unavailableLaps('not_retained_or_stale');
}
