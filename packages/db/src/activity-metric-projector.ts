import { createHash } from 'node:crypto';
import { ACTIVITY_METRIC_CATALOG, ACTIVITY_METRIC_PARSER_VERSION, inspectActivityMetrics, type MetricInput, type MetricProvider } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database, Json } from './schema.js';
import { ActivityMetricsRepository, type MetricReference, type ProjectionWrite } from './repositories/activity-metrics.repository.js';
import { GarminActivityResourcesRepository } from './repositories/garmin-activity-resources.repository.js';
import { GarminStrengthRepository } from './repositories/garmin-strength.repository.js';
export type DetailExecutor = <T>(callback:(db:Kysely<Database>)=>Promise<T>)=>Promise<T>;
export interface MetricProjectionResult {
  provider: MetricProvider; category: 'newly_projected' | 'already_current' | 'stale' | 'eligible' | 'errors';
  compactOnly: boolean; linkedButUnretained: boolean; missingCategories: string[];
}
/** Retained reads only. This module has no provider adapter, auth helper or
 * network dependency. Supply separate, already owner-scoped database executors. */
export class RetainedActivityMetricsProjector {
  constructor(private readonly primary:Kysely<Database>,private readonly withDetail:DetailExecutor) {}
  async project(activityId:string,dryRun=false):Promise<MetricProjectionResult[]> {
    const repo=new ActivityMetricsRepository(this.primary);
    const activity=await this.primary.selectFrom('activities').select(['id','activity_type']).where('id','=',activityId).executeTakeFirst();
    if (!activity) return [];
    const refs=await repo.references([activityId]);
    return this.projectReferences(activity.activity_type,refs,dryRun);
  }
  /** Batch compact metadata only; rich inspection and publication stay per source. */
  async projectBatch(activityIds:readonly string[],dryRun=false):Promise<Map<string,MetricProjectionResult[]>> {
    if (activityIds.length>100) throw new Error('Metric projection batch exceeds limit.');
    if (!activityIds.length) return new Map();
    const activities=await this.primary.selectFrom('activities').select(['id','activity_type']).where('id','in',[...activityIds]).execute();
    const refs=await new ActivityMetricsRepository(this.primary).references(activities.map(a=>a.id));
    const results=new Map<string,MetricProjectionResult[]>();
    for (const activity of activities) results.set(activity.id,await this.projectReferences(activity.activity_type,refs.filter(r=>r.activityId===activity.id),dryRun));
    return results;
  }
  private async projectReferences(sport:string,refs:MetricReference[],dryRun:boolean):Promise<MetricProjectionResult[]> {
    const repo=new ActivityMetricsRepository(this.primary); const results:MetricProjectionResult[]=[];
    for (const reference of refs) {
      const clock=await sql<{time:string}>`select clock_timestamp()::text as time`.execute(this.primary);
      const inspectedAt=clock.rows[0]!.time;
      let richRetained:boolean|null=null; let phase:'retained_read_failed'|'projection_failed'='retained_read_failed';
      try {
        const inspection=await this.inspect(reference,sport); richRetained=inspection.richRetained;
        phase='projection_failed';
        const write:ProjectionWrite={...inspection,reference,inspectedAt};
        const category=dryRun ? await this.preview(write) : await repo.checkpoint(write) ? await repo.publish(write) : 'stale';
        results.push({provider:reference.provider,category,compactOnly:inspection.compactOnly,linkedButUnretained:!inspection.richRetained,missingCategories:inspection.missingCategories});
      } catch {
        if (!dryRun) await repo.failure(reference,phase,richRetained,inspectedAt);
        results.push({provider:reference.provider,category:'errors',compactOnly:false,linkedButUnretained:false,missingCategories:[phase]});
      }
    }
    return results;
  }
  private async preview(write:ProjectionWrite):Promise<MetricProjectionResult['category']> {
    const existing=await this.primary.selectFrom('activity_metric_heads as h').innerJoin('activity_metric_projections as p',j=>j.onRef('p.owner_id','=','h.owner_id').onRef('p.id','=','h.projection_id'))
      .select('p.id').where('h.activity_id','=',write.reference.activityId).where('h.provider','=',write.reference.provider)
      .where('p.source_ref','=',write.reference.sourceRef).where('p.source_version','=',write.reference.sourceVersion)
      .where('p.input_hash','=',write.inputHash).where('p.parser_version','=',ACTIVITY_METRIC_PARSER_VERSION).where('h.failure_category','is',null).executeTakeFirst();
    return existing ? 'already_current' : write.state==='stale' ? 'stale' : 'eligible';
  }
  private async inspect(ref:MetricReference,sport:string) {
    const inputs:MetricInput[]=[]; const signatures:unknown[]=[ref.sourceRef,ref.sourceVersion]; let richRetained=false; let stale=false; let incomplete=false;
    if (ref.provider==='strava') {
      const source=await this.primary.selectFrom('source_records').select('raw_json').where('id','=',ref.sourceRecordId!).where('row_hash','=',ref.sourceVersion).where('source','=','strava_api').executeTakeFirst();
      if (!source) throw new Error('Retained provider summary missing.');
      inputs.push({provider:'strava',sourceKind:'compact',fields:source.raw_json});
      const detail=await this.withDetail(db=>readStravaMetricDetail(db,ref));
      if (detail) {
        richRetained=detail.availability==='available'; stale=detail.provider_version!==ref.sourceVersion;
        signatures.push(detail.provider_version,detail.metrics,detail.availability);
        if (richRetained && !stale) inputs.push({provider:'strava',sourceKind:'strava_detail',fields:detail.metrics});
        if (!richRetained) incomplete=true;
      }
    } else {
      const version=await this.primary.selectFrom('garmin_activity_versions').select('summary_json').where('identity_id','=',ref.sourceRef).where('content_hash','=',ref.sourceVersion).orderBy('origin').executeTakeFirst();
      if (!version) throw new Error('Retained Garmin summary missing.');
      inputs.push({provider:'garmin',sourceKind:'compact',fields:version.summary_json});
      const retained=await this.withDetail(async db=> {
        const resources=new GarminActivityResourcesRepository(db); const reference={identityKey:ref.identityKey!,sourceHash:ref.sourceVersion};
        const [coverage,expected,sessions]=await Promise.all([resources.coverage(reference),resources.expectedResources(reference),resources.messages(reference,'session',2)]);
        const complete=Array.isArray(expected) && expected.length>=3 && expected.length<=100 && expected.every(item=>item && typeof item==='object' && !Array.isArray(item) && coverage.some(r=>r.resourceType===item.resourceType && r.chunkIndex===item.chunkIndex));
        return {sessions,complete,hasRaw:coverage.some(r=>r.resourceType==='records')};
      });
      richRetained=retained.hasRaw; incomplete=!retained.complete || retained.sessions.length!==1;
      if (retained.sessions.length===1) inputs.push({provider:'garmin',sourceKind:'fit_session',fields:retained.sessions[0]});
      signatures.push(retained.sessions,retained.complete,retained.hasRaw);
      // Reuse existing compact strength semantics; detailed exercise rows never
      // become competing scalar values or affect official scores here.
      if (sport==='workout') {
        const strength=await new GarminStrengthRepository(this.primary).forActivity(ref.activityId);
        if (strength) { inputs.push({provider:'garmin',sourceKind:'strength_summary',fields:strength}); signatures.push([strength.workingSets,strength.totalRecordedSets,strength.warmupSets,strength.restMarkers,strength.unknownSets,strength.exerciseCount,strength.complete]); if (!strength.complete) incomplete=true; }
      }
    }
    const inspected=inspectActivityMetrics(sport,inputs);
    // A source-backed fallback is allowed only for the exact current Strava
    // source link. Manual/workbook values never become Strava observations.
    if (ref.provider==='strava') {
      const canonical=await this.primary.selectFrom('activities').selectAll().where('id','=',ref.activityId)
        .where('source','=','strava').where('source_record_id','=',ref.sourceRecordId!).where('source_activity_id','=',ref.providerActivityId!).executeTakeFirst();
      if (canonical) for (const definition of ACTIVITY_METRIC_CATALOG) {
        if (!definition.canonicalColumn || !definition.sports.includes(sport as never) || inspected.observations.some(o=>o.metricKey===definition.key)) continue;
        const raw=(canonical as unknown as Record<string,unknown>)[definition.canonicalColumn];
        const value=raw===null || raw===undefined ? NaN : Number(raw);
        if (!Number.isFinite(value) || value<definition.min || value>definition.max) continue;
        inspected.observations.push({metricKey:definition.key,value,unit:definition.unit,sourceKind:'canonical_fallback',sourceField:definition.canonicalColumn,sourceUnit:definition.unit,origin:'provider_derived',precedence:0});
        inspected.missing=Math.max(0,inspected.missing-1);
      }
      signatures.push(inspected.observations.filter(o=>o.sourceKind==='canonical_fallback'));
    } const compactOnly=inputs.every(i=>i.sourceKind==='compact');
    return {...inspected,richRetained,compactOnly,state:stale ? 'stale' as const : compactOnly || incomplete || inspected.rejected>0 ? 'partial' as const : 'processed' as const,
      inputHash:hash(signatures),missingCategories:stale ? ['stale_detail'] : !richRetained ? [ref.provider==='strava'?'detail':'fit_session'] : incomplete ? ['incomplete_rich_resources'] : []};
  }
}
export async function readStravaMetricDetail(db:Kysely<Database>,ref:MetricReference) {
  const fields=[...new Set(ACTIVITY_METRIC_CATALOG.flatMap(d=>d.mappings.filter(m=>m.provider==='strava' && m.sourceKind==='strava_detail').map(m=>m.field)))];
  return db.selectFrom('activity_provider_resources').select(['provider_version','availability',
    sql<Json>`(select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(case when jsonb_typeof(payload_json)='object' then payload_json else '{}'::jsonb end) where key = any(${fields}::text[]) and jsonb_typeof(value) in ('number','null','boolean','string') and octet_length(value::text) <= 100)`.as('metrics')])
    .where('activity_id','=',ref.activityId).where('provider','=','strava').where('provider_activity_id','=',ref.providerActivityId!).where('resource_type','=','detail').executeTakeFirst();
}
function hash(value:unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
