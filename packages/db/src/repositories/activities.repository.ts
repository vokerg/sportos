import type { Kysely } from 'kysely';
import type { Activity, Database } from '../schema.js';

export const ACTIVITY_TYPES = ['steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'bonus'] as const satisfies readonly Activity['activity_type'][];
export const ACTIVITY_SOURCES = ['manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets', 'strava', 'garmin', 'fit'] as const satisfies readonly Activity['source'][];

export interface ActivitiesQuery {
  from?: string;
  to?: string;
  activityType?: Activity['activity_type'];
  source?: Activity['source'];
  limit: number;
  offset: number;
}

const publicColumns = [
  'id', 'source', 'source_activity_id', 'activity_date', 'start_time', 'activity_type', 'subtype',
  'distance_m', 'duration_s', 'moving_time_s', 'steps', 'calories', 'avg_hr', 'max_hr',
  'elevation_gain_m', 'avg_speed_mps', 'avg_pace_s_per_km', 'effort_points', 'notes',
] as const;

function serialize(row: Record<string, unknown>) {
  const result = { ...row };
  result.activity_date = row.activity_date instanceof Date ? row.activity_date.toISOString().slice(0, 10) : row.activity_date;
  result.start_time = row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time;
  for (const field of ['distance_m', 'elevation_gain_m', 'avg_speed_mps', 'avg_pace_s_per_km']) {
    if (row[field] !== null && row[field] !== undefined) result[field] = Number(row[field]);
  }
  return result;
}

export class ActivitiesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async list(input: ActivitiesQuery) {
    let filtered = this.db.selectFrom('activities');
    if (input.from) filtered = filtered.where('activity_date', '>=', input.from);
    if (input.to) filtered = filtered.where('activity_date', '<=', input.to);
    if (input.activityType) filtered = filtered.where('activity_type', '=', input.activityType);
    if (input.source) filtered = filtered.where('source', '=', input.source);
    const [rows, summary] = await Promise.all([
      filtered.select(publicColumns)
        .orderBy('activity_date', 'desc').orderBy('start_time', 'desc').orderBy('id', 'desc')
        .limit(input.limit).offset(input.offset).execute(),
      filtered.select((eb) => [
        eb.fn.countAll<string>().as('count'),
        eb.fn.sum<string>('duration_s').as('duration_s'),
        eb.fn.sum<string>('distance_m').as('distance_m'),
      ]).executeTakeFirstOrThrow(),
    ]);
    return {
      items: rows.map((row) => serialize(row)),
      summary: { count: Number(summary.count), durationS: Number(summary.duration_s ?? 0), distanceM: Number(summary.distance_m ?? 0) },
      limit: input.limit,
      offset: input.offset,
    };
  }

  async get(activityId: string) {
    const row = await this.db.selectFrom('activities as activity')
      .leftJoin('source_records as record', 'record.id', 'activity.source_record_id')
      .select(publicColumns.map((column) => `activity.${column}` as const))
      .select(['record.id as sourceRecordId', 'record.source as sourceRecordSource'])
      .where('activity.id', '=', activityId).executeTakeFirst();
    if (!row) return null;
    const { sourceRecordId, sourceRecordSource, ...activity } = row;
    return {
      ...serialize(activity),
      provenance: { sourceRecordId, sourceRecordSource },
    };
  }
}
