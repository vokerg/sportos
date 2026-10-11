import { ACTIVITY_METRIC_CATALOG, ACTIVITY_METRIC_PARSER_VERSION, selectProviderMetrics, type MetricProvider, type MetricObservation, type MetricInspection } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Database, Activity } from '../schema.js';
import { lockActivityReconciliation } from './garmin-activities.repository.js';
export interface MetricReference { activityId: string; provider: MetricProvider; sourceRef: string; sourceVersion: string; identityKey?: string; sourceRecordId?: string; providerActivityId?: string; }
export interface MetricProviderStatus {
  provider: MetricProvider; linked: boolean; compactRetained: boolean; rawRetained: boolean | null;
  state: 'not_linked' | 'linked_unprocessed' | 'linked_no_rich_data' | 'raw_retained_unprocessed' | 'processed' | 'partial' | 'failed' | 'stale';
  lastProjectedAt: string | null; failureCategory: string | null; valueCount: number;
  missingCount: number; rejectedCount: number; compactOnly: boolean; missingCategories: string[];
}
export interface MetricComparison {
  key: string; label: string; unit: string;
  selected: { value: number; source: string; reason: 'canonical_authority' | 'provider_priority' } | null;
  candidates: { provider: MetricProvider; value: number; sourceKind: string; sourceField: string; sourceUnit: string; origin: string; selectedWithinProvider: boolean; projectionId: string; projectedAt: string }[];
}
export interface ProjectionWrite extends MetricInspection { reference: MetricReference; inspectedAt: Date | string; inputHash: string; richRetained: boolean; compactOnly: boolean; state: 'processed' | 'partial' | 'stale'; }
export class ActivityMetricsRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async available() {
    const result = await sql<{available:boolean}>`select to_regclass('public.activity_metric_heads') is not null as available`.execute(this.db);
    return result.rows[0]?.available === true;
  }
  /** Metadata only; safe to batch for activity navigation. No detail DB access. */
  async references(ids: readonly string[]): Promise<MetricReference[]> {
    if (!ids.length) return []; if (ids.length > 100) throw new Error('Metric reference batch exceeds limit.');
    const [strava,garmin] = await Promise.all([
      this.db.selectFrom('provider_activity_links as l').innerJoin('provider_connections as c',j=>j.onRef('c.owner_id','=','l.owner_id').onRef('c.id','=','l.connection_id'))
        .innerJoin('source_records as s',j=>j.onRef('s.owner_id','=','l.owner_id').onRef('s.id','=','l.latest_source_record_id'))
        .select(['l.activity_id','l.id','l.provider_activity_id','s.id as source_record_id','s.row_hash']).where('l.activity_id','in',[...ids]).where('l.availability','=','available').where('c.provider','=','strava').where('s.source','=','strava_api')
        .orderBy('l.updated_at','desc').orderBy('l.id','desc').execute(),
      this.db.selectFrom('garmin_activity_identities').select(['activity_id','id','identity_key','current_hash']).where('activity_id','in',[...ids]).execute(),
    ]);
    const refs: MetricReference[] = []; const seen = new Set<string>();
    for (const row of strava) if (!seen.has(row.activity_id)) { seen.add(row.activity_id); refs.push({activityId:row.activity_id,provider:'strava',sourceRef:row.id,sourceVersion:row.row_hash,sourceRecordId:row.source_record_id,providerActivityId:row.provider_activity_id}); }
    for (const row of garmin) if (row.activity_id) refs.push({activityId:row.activity_id,provider:'garmin',sourceRef:row.id,sourceVersion:row.current_hash,identityKey:row.identity_key});
    return refs;
  }
  async statuses(ids: readonly string[]): Promise<Record<string, MetricProviderStatus[]>> {
    if (!ids.length) return {}; if (!await this.available()) return {};
    const [refs,heads] = await Promise.all([this.references(ids),this.db.selectFrom('activity_metric_heads as h')
      .leftJoin('activity_metric_projections as p',j=>j.onRef('p.owner_id','=','h.owner_id').onRef('p.id','=','h.projection_id'))
      .select(['h.activity_id','h.provider','h.source_ref','h.source_version','h.state','h.rich_retained','h.failure_category','h.expected_input_hash','p.input_hash','p.projected_at','p.value_count','p.missing_count','p.rejected_count','p.compact_only','p.parser_version','p.source_ref as projected_ref','p.source_version as projected_version'])
      .where('h.activity_id','in',[...ids]).execute()]);
    return Object.fromEntries(ids.map(id => [id,!refs.some(r=>r.activityId===id) ? [] : (['strava','garmin'] as const).map(provider => {
      const ref = refs.find(r=>r.activityId===id && r.provider===provider); const head = heads.find(h=>h.activity_id===id && h.provider===provider);
      const current = ref && head && ref.sourceRef===head.source_ref && ref.sourceVersion===head.source_version;
      const stale = Boolean(ref && head && (!current || (head.parser_version !== null && head.parser_version !== ACTIVITY_METRIC_PARSER_VERSION)));
      const projectedCurrent = current && head.projected_ref === ref.sourceRef && head.projected_version === ref.sourceVersion && (head.expected_input_hash===null || head.expected_input_hash===head.input_hash);
      const rawRetained = current ? head.rich_retained : null;
      return { provider,linked:Boolean(ref),compactRetained:Boolean(ref),rawRetained,
        state:!ref ? 'not_linked' : stale ? 'stale' : head ? head.state === 'unprocessed' ? rawRetained === true ? 'raw_retained_unprocessed' : rawRetained === false ? 'linked_no_rich_data' : 'linked_unprocessed' : head.state : 'linked_unprocessed',
        lastProjectedAt:head?.projected_at?.toISOString() ?? null,failureCategory:current ? head.failure_category : null,
        valueCount:projectedCurrent ? head.value_count ?? 0 : 0,missingCount:projectedCurrent ? head.missing_count ?? 0 : 0,rejectedCount:projectedCurrent ? head.rejected_count ?? 0 : 0,
        compactOnly:projectedCurrent ? head.compact_only ?? true : true,missingCategories:!ref || rawRetained===true ? [] : [provider==='strava' ? 'detail' : 'fit_session'],
      } satisfies MetricProviderStatus;
    })]));
  }
  async comparisons(activity: Pick<Activity,'id'|'source'|'activity_type'> & Record<string, unknown>): Promise<MetricComparison[]> {
    if (!await this.available()) return [];
    const refs = await this.references([activity.id]);
    const rows = await this.db.selectFrom('activity_metric_heads as h')
      .innerJoin('activity_metric_projections as p',j=>j.onRef('p.owner_id','=','h.owner_id').onRef('p.id','=','h.projection_id'))
      .innerJoin('activity_provider_metric_values as v',j=>j.onRef('v.owner_id','=','p.owner_id').onRef('v.projection_id','=','p.id'))
      .select(['h.provider','h.source_ref','h.source_version','h.expected_input_hash','p.input_hash','p.id as projection_id','p.source_ref as projected_ref','p.source_version as projected_version','p.parser_version','p.projected_at',
        'v.metric_key','v.value','v.unit','v.source_kind','v.source_field','v.source_unit','v.origin','v.precedence'])
      .where('h.activity_id','=',activity.id).orderBy('v.metric_key').orderBy('h.provider').orderBy('v.precedence','desc').orderBy('v.source_field').limit(400).execute();
    const currentRows = rows.filter(row => (row.expected_input_hash===null || row.expected_input_hash===row.input_hash) && row.parser_version === ACTIVITY_METRIC_PARSER_VERSION && refs.some(ref => ref.provider===row.provider && ref.sourceRef===row.projected_ref && ref.sourceVersion===row.projected_version));
    return ACTIVITY_METRIC_CATALOG.filter(d=>d.sports.includes(activity.activity_type as never)).flatMap(d=> {
      const matches = currentRows.filter(r=>r.metric_key===d.key);
      const winners = new Map<MetricProvider, MetricObservation>();
      for (const provider of ['strava','garmin'] as const) {
        const observations = matches.filter(r=>r.provider===provider).map(observation);
        const selected = selectProviderMetrics(observations)[0]; if (selected) winners.set(provider,selected);
      }
      const canonicalRaw = d.canonicalColumn ? activity[d.canonicalColumn] : null;
      const canonicalValue = typeof canonicalRaw === 'number' || typeof canonicalRaw === 'string' ? Number(canonicalRaw) : null;
      const authority = d.canonicalColumn !== undefined;
      const provider = d.priority.find(p=>winners.has(p)); const winner = provider ? winners.get(provider) : undefined;
      const selected: MetricComparison['selected'] = authority ? typeof canonicalValue === 'number' && Number.isFinite(canonicalValue) ? {value:canonicalValue,source:activity.source,reason:'canonical_authority'} : null
        : winner && provider ? {value:winner.value,source:provider,reason:'provider_priority'} : null;
      if (!matches.length && !selected) return [];
      return [{key:d.key,label:d.label,unit:d.unit,selected,candidates:matches.map(r=>({provider:r.provider,value:r.value,sourceKind:r.source_kind,sourceField:r.source_field,sourceUnit:r.source_unit,origin:r.origin,
        selectedWithinProvider:winners.get(r.provider)?.sourceField===r.source_field && winners.get(r.provider)?.sourceKind===r.source_kind,projectionId:r.projection_id,projectedAt:r.projected_at.toISOString()}))}];
    });
  }
  /** Checkpoint availability independently of completion. A process interrupted
   * between this write and publication exposes raw-retained/unprocessed rather
   * than claiming success. Unchanged completed replays make no mutation. */
  async checkpoint(write:ProjectionWrite):Promise<boolean> {
    return this.db.transaction().execute(async tx=>{
      await lockActivityReconciliation(tx);
      const ref=(await new ActivityMetricsRepository(tx).references([write.reference.activityId])).find(r=>r.provider===write.reference.provider);
      if (!sameReference(ref,write.reference)) return false;
      const r=write.reference;
      const head=await tx.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',r.activityId).where('provider','=',r.provider).executeTakeFirst();
      if(await hasNewerInspection(tx,r,write.inspectedAt)) return false;
      if(head && head.source_ref===r.sourceRef && head.source_version===r.sourceVersion && head.expected_input_hash===write.inputHash) return true;
      const values={activity_id:r.activityId,provider:r.provider,source_ref:r.sourceRef,source_version:r.sourceVersion,expected_input_hash:write.inputHash,state:'unprocessed' as const,rich_retained:write.richRetained,failure_category:null,inspected_at:write.inspectedAt,updated_at:new Date()};
      await tx.insertInto('activity_metric_heads').values({...values,projection_id:null}).onConflict(oc=>oc.columns(['owner_id','activity_id','provider']).doUpdateSet(values)).execute();
      return true;
    });
  }
  /** Source identity rechecked under the same lock as provider reconciliation.
   * Retention/read happens before this short primary-only transaction. */
  async publish(write: ProjectionWrite): Promise<'newly_projected' | 'already_current' | 'stale'> {
    if (write.observations.length > 200) throw new Error('Metric projection exceeds bound.');
    return this.db.transaction().execute(async tx=> {
      await lockActivityReconciliation(tx); const repo = new ActivityMetricsRepository(tx);
      const ref = (await repo.references([write.reference.activityId])).find(r=>r.provider===write.reference.provider);
      if (!sameReference(ref,write.reference)) return 'stale';
      const r=write.reference;
      const existing = await tx.selectFrom('activity_metric_projections').select('id').where('activity_id','=',r.activityId).where('provider','=',r.provider)
        .where('source_ref','=',r.sourceRef).where('source_version','=',r.sourceVersion).where('input_hash','=',write.inputHash).where('parser_version','=',ACTIVITY_METRIC_PARSER_VERSION).executeTakeFirst();
      const head = await tx.selectFrom('activity_metric_heads').selectAll().where('activity_id','=',r.activityId).where('provider','=',r.provider).executeTakeFirst();
      if (await hasNewerInspection(tx,r,write.inspectedAt)) return 'stale';
      if (existing && head?.projection_id===existing.id && head.state===write.state && head.failure_category===null) return 'already_current';
      const projection = existing ?? await tx.insertInto('activity_metric_projections').values({activity_id:r.activityId,provider:r.provider,source_ref:r.sourceRef,source_version:r.sourceVersion,input_hash:write.inputHash,
        parser_version:ACTIVITY_METRIC_PARSER_VERSION,state:write.state,rich_retained:write.richRetained,compact_only:write.compactOnly,missing_count:write.missing,rejected_count:write.rejected,value_count:selectProviderMetrics(write.observations).length}).returning('id').executeTakeFirstOrThrow();
      if (!existing && write.observations.length) await tx.insertInto('activity_provider_metric_values').values(write.observations.map(o=>({activity_id:r.activityId,provider:r.provider,projection_id:projection.id,metric_key:o.metricKey,value:o.value,unit:o.unit,
        source_kind:o.sourceKind,source_field:o.sourceField,source_unit:o.sourceUnit,origin:o.origin,precedence:o.precedence}))).execute();
      const values = {activity_id:r.activityId,provider:r.provider,source_ref:r.sourceRef,source_version:r.sourceVersion,projection_id:projection.id,expected_input_hash:write.inputHash,state:write.state,rich_retained:write.richRetained,failure_category:null,inspected_at:write.inspectedAt,updated_at:new Date()};
      await tx.insertInto('activity_metric_heads').values(values).onConflict(oc=>oc.columns(['owner_id','activity_id','provider']).doUpdateSet(values)).execute();
      return 'newly_projected';
    });
  }
  async failure(reference: MetricReference, category: 'retained_read_failed' | 'projection_failed', richRetained: boolean | null, inspectedAt: Date | string) {
    await this.db.transaction().execute(async tx=> {
      await lockActivityReconciliation(tx);
      const repo=new ActivityMetricsRepository(tx); const current=(await repo.references([reference.activityId])).find(r=>r.provider===reference.provider);
      if (!sameReference(current,reference)) return;
      if (await hasNewerInspection(tx,reference,inspectedAt)) return;
      const values={activity_id:reference.activityId,provider:reference.provider,source_ref:reference.sourceRef,source_version:reference.sourceVersion,state:'failed' as const,rich_retained:richRetained,failure_category:category,inspected_at:inspectedAt,updated_at:new Date()};
      // Keep previous successful projection and timestamp on error.
      await tx.insertInto('activity_metric_heads').values({...values,projection_id:null}).onConflict(oc=>oc.columns(['owner_id','activity_id','provider']).doUpdateSet(values)).execute();
    });
  }
}
function observation(r: {metric_key:string;value:number;unit:string;source_kind:MetricObservation['sourceKind'];source_field:string;source_unit:string;origin:MetricObservation['origin'];precedence:number}): MetricObservation {
  return {metricKey:r.metric_key,value:r.value,unit:r.unit,sourceKind:r.source_kind,sourceField:r.source_field,sourceUnit:r.source_unit,origin:r.origin,precedence:r.precedence};
}
export function sameReference(a: MetricReference | undefined,b: MetricReference) { return a?.activityId===b.activityId && a.provider===b.provider && a.sourceRef===b.sourceRef && a.sourceVersion===b.sourceVersion; }

async function hasNewerInspection(db:Kysely<Database>,ref:MetricReference,at:Date|string):Promise<boolean> {
  // Compare in Postgres to preserve clock microseconds across concurrent reads;
  // JS Date comparisons would collapse inspections started in the same millisecond.
  return Boolean(await db.selectFrom('activity_metric_heads').select('activity_id').where('activity_id','=',ref.activityId).where('provider','=',ref.provider).where('inspected_at','>',sql<Date>`${at}::timestamptz`).executeTakeFirst());
}
