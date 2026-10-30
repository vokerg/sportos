import {inRepositoryTransaction} from '../ownership-context.js';
import { RUNNING_EFFORT_ALGORITHM_VERSION, RUNNING_EFFORT_TARGETS, unavailableEfforts, type RunningEffort } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';
import { ActivityMetricsRepository, sameReference, type MetricReference } from './activity-metrics.repository.js';
import { lockActivityReconciliation } from './garmin-activities.repository.js';
export interface EffortWrite { reference: MetricReference; inputHash: string; resourceHash?: string | null; inspectedAt: string; efforts: RunningEffort[]; }
export interface EffortProviderReadModel {
  provider: 'strava' | 'garmin'; state: 'current' | 'unprocessed' | 'stale' | 'failed' | 'not_linked';
  projectedAt: string | null; algorithmVersion: number | null; efforts: RunningEffort[];
}
export class RunningEffortsRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async available() {
    const result = await sql<{ available: boolean }>`select to_regclass('public.running_effort_heads') is not null as available`.execute(this.db);
    return result.rows[0]?.available === true;
  }
  async read(activityId: string) {
    const available = await this.available();
    if (!available) return null;
    const refs = await new ActivityMetricsRepository(this.db).references([activityId]);
    const heads = available ? await this.db.selectFrom('running_effort_heads as h')
      .leftJoin('running_effort_projections as p', j => j.onRef('p.owner_id', '=', 'h.owner_id').onRef('p.id', '=', 'h.projection_id'))
      .select(['h.provider', 'h.source_ref', 'h.source_version', 'h.state', 'h.failure_category', 'h.expected_resource_hash', 'p.resource_hash', 'p.id', 'p.source_ref as projected_ref', 'p.source_version as projected_version', 'p.algorithm_version', 'p.projected_at'])
      .where('h.activity_id', '=', activityId).execute() : [];
    const providers: EffortProviderReadModel[] = [];
    for (const provider of ['strava', 'garmin'] as const) {
      const ref = refs.find(r => r.provider === provider), head = heads.find(h => h.provider === provider);
      const stale = head && ref && (head.source_ref !== ref.sourceRef || head.source_version !== ref.sourceVersion || head.projected_ref !== ref.sourceRef || head.projected_version !== ref.sourceVersion || head.algorithm_version !== RUNNING_EFFORT_ALGORITHM_VERSION || (head.expected_resource_hash !== null && head.expected_resource_hash !== head.resource_hash));
      const state = !ref ? 'not_linked' : !head ? 'unprocessed' : head.state === 'failed' ? 'failed' : stale ? 'stale' : head.state;
      const values = state === 'current' && head?.id ? await this.db.selectFrom('running_effort_values').selectAll().where('projection_id', '=', head.id).execute() : [];
      const missing = unavailableEfforts(provider === 'strava' ? 'summary_estimate' : 'fit_calculated', state === 'not_linked' ? `no_${provider}_link` : head?.failure_category ?? (state === 'unprocessed' ? 'not_processed' : 'source_or_algorithm_changed'));
      const efforts = missing.map(empty => {
        const value = values.find(v => v.target_distance_m === empty.targetDistanceM);
        return value ? { targetDistanceM: value.target_distance_m, method: value.method, status: value.status, reason: value.reason,
          durationS: value.duration_s, sourceDistanceM: value.source_distance_m, coverageDistanceM: value.coverage_distance_m,
          startOffsetS: value.start_offset_s, endOffsetS: value.end_offset_s, pausePolicy: value.pause_policy, pauseCoverage: value.pause_coverage } : empty;
      });
      providers.push({ provider, state, projectedAt: head?.projected_at?.toISOString() ?? null, algorithmVersion: head?.algorithm_version ?? null, efforts });
    }
    return { targets: [...RUNNING_EFFORT_TARGETS], providers };
  }
  async isCurrent(ref: MetricReference, inputHash: string) {
    return Boolean(await this.db.selectFrom('running_effort_heads as h')
      .innerJoin('running_effort_projections as p', j => j.onRef('p.owner_id', '=', 'h.owner_id').onRef('p.id', '=', 'h.projection_id'))
      .select('p.id').where('h.activity_id', '=', ref.activityId).where('h.provider', '=', ref.provider).where('h.state', '=', 'current')
      .where('p.source_ref', '=', ref.sourceRef).where('p.source_version', '=', ref.sourceVersion).where('p.input_hash', '=', inputHash)
      .where('p.algorithm_version', '=', RUNNING_EFFORT_ALGORITHM_VERSION).where(eb=>eb.or([eb('h.expected_resource_hash','is',null),eb('h.expected_resource_hash','=',eb.ref('p.resource_hash'))])).executeTakeFirst());
  }
  async publish(write: EffortWrite): Promise<'newly_projected' | 'already_current' | 'stale'> {
    if (write.efforts.length !== RUNNING_EFFORT_TARGETS.length || write.efforts.some((e, i) => e.targetDistanceM !== RUNNING_EFFORT_TARGETS[i])) throw new Error('Invalid bounded effort catalog.');
    return inRepositoryTransaction(this.db,async tx => {
      await lockActivityReconciliation(tx); const repo = new RunningEffortsRepository(tx), r = write.reference;
      if (!await this.accepts(tx, r, write.inspectedAt)) return 'stale';
      const intent = await tx.selectFrom('running_effort_heads').select('expected_resource_hash').where('activity_id','=',r.activityId).where('provider','=',r.provider).executeTakeFirst();
      if (r.provider==='strava' && intent?.expected_resource_hash && intent.expected_resource_hash !== write.resourceHash) return 'stale';
      if (await repo.isCurrent(r, write.inputHash)) return 'already_current';
      const existing = await tx.selectFrom('running_effort_projections').select('id').where('activity_id', '=', r.activityId).where('provider', '=', r.provider)
        .where('source_ref', '=', r.sourceRef).where('source_version', '=', r.sourceVersion).where('input_hash', '=', write.inputHash).where('algorithm_version', '=', RUNNING_EFFORT_ALGORITHM_VERSION).executeTakeFirst();
      const projection = existing ?? await tx.insertInto('running_effort_projections').values({ activity_id: r.activityId, provider: r.provider,
        source_ref: r.sourceRef, source_version: r.sourceVersion, input_hash: write.inputHash, resource_hash: write.resourceHash ?? null, algorithm_version: RUNNING_EFFORT_ALGORITHM_VERSION }).returning('id').executeTakeFirstOrThrow();
      if (!existing) await tx.insertInto('running_effort_values').values(write.efforts.map(e => ({ activity_id: r.activityId, provider: r.provider, projection_id: projection.id,
        target_distance_m: e.targetDistanceM, method: e.method, status: e.status, reason: e.reason, duration_s: e.durationS,
        source_distance_m: e.sourceDistanceM, coverage_distance_m: e.coverageDistanceM, start_offset_s: e.startOffsetS, end_offset_s: e.endOffsetS,
        pause_policy: e.pausePolicy, pause_coverage: e.pauseCoverage }))).execute();
      const head = { activity_id: r.activityId, provider: r.provider, source_ref: r.sourceRef, source_version: r.sourceVersion,
        projection_id: projection.id, expected_resource_hash: null, state: 'current' as const, failure_category: null, inspected_at: write.inspectedAt };
      await tx.insertInto('running_effort_heads').values(head).onConflict(oc => oc.columns(['owner_id', 'activity_id', 'provider']).doUpdateSet(head)).execute();
      return 'newly_projected';
    });
  }
  async mark(ref: MetricReference, state: 'stale' | 'failed', inspectedAt: string, failure: 'retained_read_failed' | 'projection_failed' | null = null, expectedResourceHash?: string) {
    await inRepositoryTransaction(this.db,async tx => {
      await lockActivityReconciliation(tx);
      if (!await this.accepts(tx, ref, inspectedAt)) return;
      const values = { activity_id: ref.activityId, provider: ref.provider, source_ref: ref.sourceRef, source_version: ref.sourceVersion,
        state, failure_category: failure, inspected_at: inspectedAt, ...(expectedResourceHash ? {expected_resource_hash:expectedResourceHash} : {}) };
      await tx.insertInto('running_effort_heads').values({ ...values, projection_id: null })
        .onConflict(oc => oc.columns(['owner_id', 'activity_id', 'provider']).doUpdateSet(values)).execute();
    });
  }
  private async accepts(tx: Kysely<Database>, ref: MetricReference, at: string) {
    const current = (await new ActivityMetricsRepository(tx).references([ref.activityId])).find(r => r.provider === ref.provider);
    if (!sameReference(current, ref)) return false;
    return !await tx.selectFrom('running_effort_heads').select('activity_id').where('activity_id', '=', ref.activityId).where('provider', '=', ref.provider)
      .where('inspected_at', '>', sql<Date>`${at}::timestamptz`).executeTakeFirst();
  }
}
