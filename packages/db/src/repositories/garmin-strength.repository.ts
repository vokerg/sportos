import { sql, type Kysely } from 'kysely';
import type { GarminStrengthSummary } from '@sportos/domain';
import type { Database, Json } from '../schema.js';

/** Primary compact evidence only; resolve links dynamically so later linking
 * requires no provider download or summary rewrite. */
export class GarminStrengthRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async retain(identityId: string, contentHash: string, origin: 'archive' | 'connect', summary: GarminStrengthSummary) {
    const version = await this.db.selectFrom('garmin_activity_versions').select('id')
      .where('identity_id', '=', identityId).where('content_hash', '=', contentHash).where('origin', '=', origin).executeTakeFirstOrThrow();
    const values = { identity_id: identityId, content_hash: contentHash, version_id: version.id,
      policy_version: summary.policyVersion, total_recorded_sets: summary.totalRecordedSets,
      working_sets: summary.workingSets, warmup_sets: summary.warmupSets, rest_markers: summary.restMarkers,
      unknown_sets: summary.unknownSets, exercise_count: summary.exerciseCount,
      exercises_json: sql<Json>`${JSON.stringify(summary.exercises)}::jsonb`, complete: summary.complete };
    await this.db.insertInto('garmin_strength_summaries').values(values)
      .onConflict(oc => oc.columns(['owner_id', 'identity_id', 'content_hash', 'policy_version']).doNothing()).execute();
    const retained = await this.db.selectFrom('garmin_strength_summaries').selectAll()
      .where('identity_id', '=', identityId).where('content_hash', '=', contentHash).where('policy_version', '=', 1).executeTakeFirstOrThrow();
    if (JSON.stringify(mapStrength(retained)) !== JSON.stringify(summary)) throw new Error('Conflicting normalized Garmin strength version.');
  }

  async forActivity(activityId: string) {
    const available = await sql<{ available: boolean }>`select to_regclass('public.garmin_strength_summaries') is not null as available`.execute(this.db);
    if (!available.rows[0]?.available) return null;
    const row = await this.current().where('i.activity_id', '=', activityId).executeTakeFirst();
    return row ? { ...mapStrength(row), sourceVersionId: row.version_id, sourceUpdatedAt: row.source_updated_at.toISOString(), derivedAt: row.derived_at.toISOString() } : null;
  }

  async forDate(date: string) {
    return this.current().innerJoin('activities as a', join => join.onRef('a.owner_id', '=', 'i.owner_id').onRef('a.id', '=', 'i.activity_id'))
      .select(['i.id as identityId', 'i.identity_key as identityKey', 'a.id as activityId'])
      .where('a.activity_date', '=', date).where('a.activity_type', '=', 'workout').orderBy('a.id').limit(21).execute();
  }

  private current() {
    return this.db.selectFrom('garmin_activity_identities as i')
      .innerJoin('garmin_strength_summaries as s', join => join.onRef('s.owner_id', '=', 'i.owner_id')
        .onRef('s.identity_id', '=', 'i.id').onRef('s.content_hash', '=', 'i.current_hash').on('s.policy_version', '=', 1))
      .select(['s.version_id','s.total_recorded_sets','s.working_sets','s.warmup_sets','s.rest_markers','s.unknown_sets',
        's.exercise_count','s.exercises_json','s.complete','s.derived_at','i.source_updated_at']);
  }
}
export function mapStrength(row: { total_recorded_sets: number; working_sets: number; warmup_sets: number;
  rest_markers: number; unknown_sets: number; exercise_count: number; exercises_json: Json; complete: boolean }): GarminStrengthSummary {
  return { policyVersion: 1, totalRecordedSets: row.total_recorded_sets, workingSets: row.working_sets,
    warmupSets: row.warmup_sets, restMarkers: row.rest_markers, unknownSets: row.unknown_sets,
    exerciseCount: row.exercise_count, exercises: row.exercises_json as unknown as GarminStrengthSummary['exercises'], complete: row.complete };
}
