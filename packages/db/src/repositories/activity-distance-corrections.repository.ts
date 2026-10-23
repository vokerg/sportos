import { sql, type Kysely, type Selectable } from 'kysely';
import { lockActivityReconciliation } from './garmin-activities.repository.js';
import type { Activity, ActivityDistanceCorrectionsTable, Database } from '../schema.js';

export interface ActivityDistanceCorrectionPublic {
  effectiveDistanceM: number;
  recordedDistanceM: number;
  recordedSource: Activity['source'];
  reason: string;
  revision: number;
  updatedAt: string;
}

export type ActivityDistanceCorrectionRow = SelectableCorrection;

type SelectableCorrection = Selectable<ActivityDistanceCorrectionsTable>;

export interface DistanceCorrectionMutation {
  activityDate: string;
  correction: ActivityDistanceCorrectionPublic | null;
  changed: boolean;
}

export class ActivityDistanceCorrectionConflictError extends Error {
  readonly code = 'ACTIVITY_DISTANCE_CORRECTION_CONFLICT' as const;
  constructor() { super('The activity distance correction changed; reload and retry.'); }
}

export class ActivityDistanceCorrectionUnsupportedError extends Error {
  readonly code = 'ACTIVITY_DISTANCE_CORRECTION_UNSUPPORTED' as const;
  constructor() { super('Distance corrections are available only for indoor swim activities.'); }
}

export class ActivityDistanceCorrectionNoChangeError extends Error {
  readonly code = 'ACTIVITY_DISTANCE_CORRECTION_NO_CHANGE' as const;
  constructor() { super('The corrected distance must differ from the recorded distance.'); }
}

export class ActivityDistanceCorrectionsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async current(activityId: string): Promise<ActivityDistanceCorrectionRow | null> {
    const row = await this.db.selectFrom('activity_distance_corrections')
      .selectAll().where('activity_id', '=', activityId).executeTakeFirst();
    return row ?? null;
  }

  async currentForActivities(activityIds: readonly string[]): Promise<Map<string, ActivityDistanceCorrectionRow>> {
    if (!activityIds.length) return new Map();
    const rows = await this.db.selectFrom('activity_distance_corrections')
      .selectAll().where('activity_id', 'in', [...activityIds]).execute();
    return new Map(rows.map(row => [row.activity_id, row]));
  }

  async save(activityId: string, effectiveDistanceM: number, reason: string, expectedRevision: number | null): Promise<DistanceCorrectionMutation | null> {
    await lockActivityReconciliation(this.db);
    const activity = await this.activityForUpdate(activityId);
    if (!activity) return null;
    this.assertTarget(activity);
    const current = await this.currentForUpdate(activityId);
    this.assertRevision(current?.revision ?? null, expectedRevision);
    if (effectiveDistanceM === Number(activity.distance_m)) throw new ActivityDistanceCorrectionNoChangeError();

    const normalizedReason = reason.trim();
    const recordedDistanceM = Number(activity.distance_m);
    if (current && Number(current.effective_distance_m) === effectiveDistanceM && current.reason === normalizedReason) {
      return { activityDate: isoDate(activity.activity_date), correction: publicCorrection(current), changed: false };
    }

    const lastHistory = current ? null : await this.db.selectFrom('activity_distance_correction_history')
      .select('revision').where('activity_id', '=', activityId)
      .orderBy('revision', 'desc').executeTakeFirst();
    const revision = (current?.revision ?? lastHistory?.revision ?? 0) + 1;
    const next = {
      owner_id: activity.owner_id,
      activity_id: activity.id,
      effective_distance_m: effectiveDistanceM,
      recorded_distance_m: current?.recorded_distance_m ?? recordedDistanceM,
      recorded_source: current?.recorded_source ?? activity.source,
      recorded_source_activity_id: current?.recorded_source_activity_id ?? activity.source_activity_id,
      recorded_source_record_id: current?.recorded_source_record_id ?? activity.source_record_id,
      recorded_source_hash: current?.recorded_source_hash ?? activity.source_record_hash,
      reason: normalizedReason,
      revision,
      actor_account_id: sql<string>` sportos_current_account_id() `,
      updated_at: new Date(),
    };
    if (current) {
      await this.db.updateTable('activity_distance_corrections').set(next).where('activity_id', '=', activityId).execute();
    } else {
      await this.db.insertInto('activity_distance_corrections').values(next).execute();
    }
    await this.insertHistory({
      owner_id: activity.owner_id,
      activity_id: activity.id,
      action: 'save',
      effective_distance_m: effectiveDistanceM,
      previous_effective_distance_m: current?.effective_distance_m ?? null,
      recorded_distance_m: current?.recorded_distance_m ?? recordedDistanceM,
      recorded_source: current?.recorded_source ?? activity.source,
      recorded_source_activity_id: current?.recorded_source_activity_id ?? activity.source_activity_id,
      recorded_source_record_id: current?.recorded_source_record_id ?? activity.source_record_id,
      recorded_source_hash: current?.recorded_source_hash ?? activity.source_record_hash,
      reason: normalizedReason,
      revision,
    });
    const saved = await this.current(activityId);
    if (!saved) throw new Error('Distance correction disappeared after save.');
    return { activityDate: isoDate(activity.activity_date), correction: publicCorrection(saved), changed: true };
  }

  async reset(activityId: string, expectedRevision: number | null): Promise<DistanceCorrectionMutation | null> {
    await lockActivityReconciliation(this.db);
    const activity = await this.activityForUpdate(activityId);
    if (!activity) return null;
    this.assertTarget(activity);
    const current = await this.currentForUpdate(activityId);
    this.assertRevision(current?.revision ?? null, expectedRevision);
    if (!current) return { activityDate: isoDate(activity.activity_date), correction: null, changed: false };

    await this.db.deleteFrom('activity_distance_corrections').where('activity_id', '=', activityId).execute();
    await this.insertHistory({
      owner_id: activity.owner_id,
      activity_id: activity.id,
      action: 'reset',
      effective_distance_m: null,
      previous_effective_distance_m: current.effective_distance_m,
      recorded_distance_m: current.recorded_distance_m,
      recorded_source: current.recorded_source,
      recorded_source_activity_id: current.recorded_source_activity_id,
      recorded_source_record_id: current.recorded_source_record_id,
      recorded_source_hash: current.recorded_source_hash,
      reason: 'Reset to recorded distance',
      revision: current.revision + 1,
    });
    return { activityDate: isoDate(activity.activity_date), correction: null, changed: true };
  }

  private async activityForUpdate(activityId: string) {
    return this.db.selectFrom('activities').select([
      'id', 'owner_id', 'activity_date', 'activity_type', 'subtype', 'distance_m', 'source',
      'source_activity_id', 'source_record_id', 'source_record_hash',
    ]).where('id', '=', activityId).forUpdate().executeTakeFirst();
  }

  private async currentForUpdate(activityId: string) {
    return this.db.selectFrom('activity_distance_corrections').selectAll()
      .where('activity_id', '=', activityId).forUpdate().executeTakeFirst();
  }

  private assertTarget(activity: { activity_type: Activity['activity_type']; subtype: Activity['subtype']; distance_m: number | null }): asserts activity is typeof activity & { distance_m: number } {
    if (activity.activity_type !== 'swim' || activity.subtype !== 'indoor' || activity.distance_m === null || !Number.isFinite(Number(activity.distance_m)) || Number(activity.distance_m) <= 0) {
      throw new ActivityDistanceCorrectionUnsupportedError();
    }
  }

  private assertRevision(current: number | null, expected: number | null): void {
    if (current !== expected) throw new ActivityDistanceCorrectionConflictError();
  }

  private insertHistory(value: {
    owner_id: string;
    activity_id: string;
    action: 'save' | 'reset';
    effective_distance_m: number | null;
    previous_effective_distance_m: number | null;
    recorded_distance_m: number | null;
    recorded_source: Activity['source'] | null;
    recorded_source_activity_id: string | null;
    recorded_source_record_id: string | null;
    recorded_source_hash: string | null;
    reason: string;
    revision: number;
  }) {
    return this.db.insertInto('activity_distance_correction_history').values({
      ...value,
      actor_account_id: sql<string>` sportos_current_account_id() `,
    }).execute();
  }
}

function publicCorrection(row: ActivityDistanceCorrectionRow): ActivityDistanceCorrectionPublic {
  return {
    effectiveDistanceM: Number(row.effective_distance_m),
    recordedDistanceM: Number(row.recorded_distance_m),
    recordedSource: row.recorded_source,
    reason: row.reason,
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  throw new Error('Invalid activity date.');
}

export function effectiveDistanceExpression(alias: string) {
  return sql<number | null>`coalesce((select correction.effective_distance_m
    from activity_distance_corrections correction
    where correction.owner_id = ${sql.ref(`${alias}.owner_id`)}
      and correction.activity_id = ${sql.ref(`${alias}.id`)}), ${sql.ref(`${alias}.distance_m`)})`;
}

export function hasDistanceCorrectionExpression(alias: string) {
  return sql<boolean>`exists (select 1 from activity_distance_corrections correction
    where correction.owner_id = ${sql.ref(`${alias}.owner_id`)}
      and correction.activity_id = ${sql.ref(`${alias}.id`)})`;
}

export function effectiveSpeedExpression(alias: string) {
  const distance = effectiveDistanceExpression(alias);
  const duration = sql`coalesce(${sql.ref(`${alias}.moving_time_s`)}, ${sql.ref(`${alias}.duration_s`)})`;
  return sql<number | null>`case when ${hasDistanceCorrectionExpression(alias)} then
      case when ${distance} > 0 and ${duration} > 0 then ${distance} / ${duration} else null end
    else ${sql.ref(`${alias}.avg_speed_mps`)} end`;
}

export function effectivePaceExpression(alias: string) {
  const distance = effectiveDistanceExpression(alias);
  const duration = sql`coalesce(${sql.ref(`${alias}.moving_time_s`)}, ${sql.ref(`${alias}.duration_s`)})`;
  return sql<number | null>`case when ${hasDistanceCorrectionExpression(alias)} then
      case when ${distance} > 0 and ${duration} > 0 then ${duration} / (${distance} / 1000.0) else null end
    else ${sql.ref(`${alias}.avg_pace_s_per_km`)} end`;
}

export function distanceCorrectionPublicExpression(alias: string) {
  return sql<ActivityDistanceCorrectionPublic | null>`(select jsonb_build_object(
      'effectiveDistanceM', correction.effective_distance_m::float8,
      'recordedDistanceM', correction.recorded_distance_m::float8,
      'recordedSource', correction.recorded_source,
      'reason', correction.reason,
      'revision', correction.revision,
      'updatedAt', correction.updated_at
    ) from activity_distance_corrections correction
    where correction.owner_id = ${sql.ref(`${alias}.owner_id`)}
      and correction.activity_id = ${sql.ref(`${alias}.id`)})`;
}

export function effectiveDistanceValue(raw: number | null, correction: ActivityDistanceCorrectionRow | undefined): number | null {
  return correction ? Number(correction.effective_distance_m) : raw === null ? null : Number(raw);
}

export function effectiveSpeedValue(raw: number | null, distance: number | null, movingTime: number | null, elapsedTime: number | null, correction: ActivityDistanceCorrectionRow | undefined): number | null {
  if (!correction) return raw === null ? null : Number(raw);
  const seconds = movingTime ?? elapsedTime;
  return distance !== null && seconds !== null && distance > 0 && seconds > 0 ? distance / seconds : null;
}

export function effectivePaceValue(raw: number | null, distance: number | null, movingTime: number | null, elapsedTime: number | null, correction: ActivityDistanceCorrectionRow | undefined): number | null {
  if (!correction) return raw === null ? null : Number(raw);
  const seconds = movingTime ?? elapsedTime;
  return distance !== null && seconds !== null && distance > 0 && seconds > 0 ? seconds / (distance / 1000) : null;
}
