import { createHash } from 'node:crypto';
import { RUNNING_EFFORT_ALGORITHM_VERSION, RUNNING_EFFORT_LIMITS, RUNNING_EFFORT_TARGETS, estimateStravaEfforts, garminFitEfforts, stravaStreamEfforts, unavailableEfforts, type RunningEffort } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database, Json } from './schema.js';
import type { DetailExecutor } from './activity-metric-projector.js';
import { ActivityMetricsRepository, type MetricReference } from './repositories/activity-metrics.repository.js';
import { GarminActivityResourcesRepository } from './repositories/garmin-activity-resources.repository.js';
import { RunningEffortsRepository } from './repositories/running-efforts.repository.js';
export interface EffortProjectionResult { provider: 'strava' | 'garmin'; category: 'newly_projected' | 'already_current' | 'eligible' | 'stale' | 'errors'; reasons: string[]; }
/** No provider/network/helper dependency. Rich content is inspected only on
 * explicit POST/operator intent; metadata signatures skip unchanged work. */
export class RetainedRunningEffortProjector {
  constructor(private readonly primary: Kysely<Database>, private readonly withDetail: DetailExecutor) {}
  async project(activityId: string, dryRun = false, provider?: 'strava' | 'garmin'): Promise<EffortProjectionResult[]> {
    const activity = await this.primary.selectFrom('activities').select('activity_type').where('id', '=', activityId).executeTakeFirst();
    if (activity?.activity_type !== 'run') return [];
    const refs = (await new ActivityMetricsRepository(this.primary).references([activityId])).filter(r => !provider || r.provider === provider);
    const repo = new RunningEffortsRepository(this.primary), results: EffortProjectionResult[] = [];
    for (const reference of refs) {
      const inspectedAt = await effortInspectionTime(this.primary); let phase: 'retained_read_failed' | 'projection_failed' = 'retained_read_failed';
      try {
        const input = await this.input(reference);
        if (await repo.isCurrent(reference, input.inputHash)) { results.push({ provider: reference.provider, category: 'already_current', reasons: [] }); continue; }
        const efforts = await input.calculate(); phase = 'projection_failed';
        const category = dryRun ? 'eligible' : await repo.publish({ reference, inputHash: input.inputHash, resourceHash:input.resourceHash, inspectedAt, efforts });
        results.push({ provider: reference.provider, category, reasons: category==='stale' ? ['concurrent_source_or_retention_change'] : [...new Set(efforts.flatMap(e => e.reason ? [e.reason] : []))] });
      } catch {
        if (!dryRun) await repo.mark(reference, 'failed', inspectedAt, phase);
        results.push({ provider: reference.provider, category: 'errors', reasons: [phase] });
      }
    }
    return results;
  }
  private async input(ref: MetricReference): Promise<{ inputHash: string; resourceHash?: string | null; calculate: () => Promise<RunningEffort[]> }> {
    if (ref.provider === 'strava') {
      const source = await this.primary.selectFrom('source_records').select([
        sql<Json>`raw_json->'distance'`.as('distance'), sql<Json>`raw_json->'moving_time'`.as('moving')])
        .where('id', '=', ref.sourceRecordId!).where('row_hash', '=', ref.sourceVersion).where('source', '=', 'strava_api').executeTakeFirstOrThrow();
      // Fallback is allowed only for this exact Strava-owned source identity.
      const canonical = await this.primary.selectFrom('activities').select(['distance_m', 'moving_time_s']).where('id', '=', ref.activityId)
        .where('source', '=', 'strava').where('source_record_id', '=', ref.sourceRecordId!).where('source_activity_id', '=', ref.providerActivityId!).executeTakeFirst();
      const distance = source.distance ?? (canonical?.distance_m == null ? null : Number(canonical.distance_m));
      const moving = source.moving ?? canonical?.moving_time_s ?? null;
      const metadata = await this.withDetail(db => stravaStreamMetadata(db, ref));
      return { inputHash: signature([ref, distance, moving, metadata ?? null]), resourceHash:metadata?.hash ?? null, calculate: async () => {
        let fallback = !metadata ? 'streams_not_retained' : metadata.provider_version !== ref.sourceVersion ? 'stale_streams' : metadata.availability !== 'available' ? 'streams_unavailable' : '';
        if (!fallback) {
          const retained = await this.withDetail(db => db.selectFrom('activity_provider_resources')
            .select(sql<Json>`jsonb_build_object('time',payload_json->'time','distance',payload_json->'distance','moving',payload_json->'moving')`.as('streams'))
            .where('activity_id', '=', ref.activityId).where('provider', '=', 'strava').where('provider_activity_id', '=', ref.providerActivityId!)
            .where('resource_type', '=', 'streams').where('provider_version', '=', ref.sourceVersion)
            .where(sql<string>`md5(payload_json::text)`, '=', metadata!.hash).where('availability', '=', 'available').executeTakeFirst());
          if (!retained) throw new Error('Retained streams changed during inspection.');
          const measured = stravaStreamEfforts(retained.streams);
          if (measured.some(e => e.pauseCoverage === 'validated')) return measured;
          fallback = measured[0].reason ?? 'invalid_streams';
        }
        return estimateStravaEfforts(distance, moving, fallback);
      } };
    }
    const summary = await this.primary.selectFrom('garmin_activity_versions')
      .select(sql<Json>`summary_json->'distanceM'`.as('distance')).where('identity_id', '=', ref.sourceRef).where('content_hash', '=', ref.sourceVersion).orderBy('origin').executeTakeFirstOrThrow();
    const resourceRef = { identityKey: ref.identityKey!, sourceHash: ref.sourceVersion };
    const metadata = await this.withDetail(async db => {
      const repo = new GarminActivityResourcesRepository(db);
      return { expected: await repo.expectedResources(resourceRef), chunks: await db.selectFrom('garmin_activity_resources')
        .select(['resource_type', 'chunk_index', 'resource_hash']).where('identity_key', '=', ref.identityKey!).where('source_hash', '=', ref.sourceVersion)
        .orderBy('resource_type').orderBy('chunk_index').limit(101).execute() };
    });
    return { inputHash: signature([ref, summary.distance, metadata]), calculate: async () => {
      const distance = typeof summary.distance === 'number' && Number.isFinite(summary.distance) && summary.distance >= 0 ? summary.distance : null;
      // Compact preflight avoids large record reads for known short runs.
      if (distance !== null && distance < RUNNING_EFFORT_TARGETS[0]) return unavailableEfforts('fit_calculated', 'too_short', distance);
      const recordChunks = metadata.chunks.filter(r => r.resource_type === 'records');
      if (!recordChunks.length) return unavailableEfforts('fit_calculated', 'no_fit_records', distance);
      if (!completeResources(metadata.expected, metadata.chunks)) return unavailableEfforts('fit_calculated', 'incomplete_fit_resources', distance);
      const messages: Json[] = [];
      for (const chunk of recordChunks) {
        const rows = await this.withDetail(db => sql<{ message: Json }>`select jsonb_build_object('message',value->'message','fields',
          (select coalesce(jsonb_agg(f),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(value->'fields')='array' then value->'fields' else '[]'::jsonb end) f
           where f->>'name' in ('timestamp','distance','event','event_type','event_group'))) as message
          from garmin_activity_resources r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.payload_json)='array' then r.payload_json else '[]'::jsonb end) with ordinality as m(value,position)
          where r.identity_key=${ref.identityKey!} and r.source_hash=${ref.sourceVersion} and r.resource_type='records' and r.chunk_index=${chunk.chunk_index}
            and r.resource_hash=${chunk.resource_hash} and value->>'message' in ('record','event','session')
          order by position limit ${RUNNING_EFFORT_LIMITS.samples + RUNNING_EFFORT_LIMITS.events + 2}`.execute(db));
        messages.push(...rows.rows.map(r => r.message));
        if (messages.length > RUNNING_EFFORT_LIMITS.samples + RUNNING_EFFORT_LIMITS.events + 1) return unavailableEfforts('fit_calculated', 'sample_limit_or_missing_records', distance);
      }
      if (messages.filter(m => m && typeof m === 'object' && !Array.isArray(m) && m.message === 'session').length !== 1) return unavailableEfforts('fit_calculated', 'multiple_or_missing_fit_sessions', distance);
      return garminFitEfforts(messages);
    } };
  }
}
export function completeResources(expected: Json, chunks: { resource_type: string; chunk_index: number }[]) {
  if (!Array.isArray(expected) || expected.length < 3 || expected.length > 100) return false;
  const seen = new Set<string>();
  for (const item of expected) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.resourceType !== 'string' || typeof item.chunkIndex !== 'number') return false;
    const key = `${item.resourceType}:${item.chunkIndex}`;
    if (seen.has(key) || !chunks.some(c => c.resource_type === item.resourceType && c.chunk_index === item.chunkIndex)) return false;
    seen.add(key);
  }
  const records = chunks.filter(c => c.resource_type === 'records');
  return records.every((c, i) => c.chunk_index === i && seen.has(`records:${i}`));
}
export async function stravaStreamMetadata(db: Kysely<Database>, ref: MetricReference) {
  return db.selectFrom('activity_provider_resources').select(['provider_version', 'availability', sql<string>`md5(payload_json::text)`.as('hash')])
    .where('activity_id', '=', ref.activityId).where('provider', '=', 'strava').where('provider_activity_id', '=', ref.providerActivityId!).where('resource_type', '=', 'streams').executeTakeFirst();
}
export async function effortInspectionTime(db: Kysely<Database>) { return (await sql<{ time: string }>`select clock_timestamp()::text as time`.execute(db)).rows[0]!.time; }
function signature(value: unknown) { return createHash('sha256').update(JSON.stringify([RUNNING_EFFORT_ALGORITHM_VERSION, RUNNING_EFFORT_TARGETS, value])).digest('hex'); }
