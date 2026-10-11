import type { Kysely } from 'kysely';
import type { Database } from './schema.js';
import { RetainedActivityMetricsProjector, type DetailExecutor } from './activity-metric-projector.js';
export interface MetricBackfillOptions { cursor?: string; limit: number; dryRun: boolean; retries?: number; }
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function validateMetricBackfillOptions(options:MetricBackfillOptions) {
  if (!Number.isInteger(options.limit) || options.limit<1 || options.limit>100 || typeof options.dryRun!=='boolean'
    || (options.cursor!==undefined && !uuid.test(options.cursor)) || (options.retries!==undefined && (!Number.isInteger(options.retries) || options.retries<0 || options.retries>2))) throw new Error('Invalid bounded metric backfill options.');
}
export function metricBackfillCounts() { return {eligible:0,newlyProjected:0,alreadyCurrent:0,compactOnly:0,stale:0,linkedButUnretained:0,pending:0,missing:0,errors:0}; }
/** Exactly one bounded batch. Persist the returned cursor only after this returns.
 * Interrupted batches can replay safely; no provider client exists on this path. */
export async function backfillRetainedActivityMetrics(primary:Kysely<Database>,detail:DetailExecutor,options:MetricBackfillOptions) {
  validateMetricBackfillOptions(options);
  let query=primary.selectFrom('activities').select('id').orderBy('id');
  if (options.cursor) query=query.where('id','>',options.cursor);
  const rows=await query.limit(options.limit+1).execute(); const batch=rows.slice(0,options.limit);
  const providers={strava:metricBackfillCounts(),garmin:metricBackfillCounts()};
  let otherActivities=0; const projector=new RetainedActivityMetricsProjector(primary,detail);
  const projected=await projector.projectBatch(batch.map(a=>a.id),options.dryRun);
  for (const activity of batch) {
    let results=projected.get(activity.id) ?? [];
    for (let retry=0;retry<(options.retries??1) && results.some(r=>r.category==='errors');retry++) {
      const retried=await projector.project(activity.id,options.dryRun);
      results=results.map(result=>result.category==='errors' ? retried.find(next=>next.provider===result.provider) ?? result : result);
    }
    if (!results.length) otherActivities++;
    for (const result of results) {
      const counts=providers[result.provider]; counts.eligible++;
      if (result.category==='newly_projected') counts.newlyProjected++;
      if (result.category==='already_current') counts.alreadyCurrent++;
      if (result.category==='stale' || result.missingCategories.includes('stale_detail')) counts.stale++;
      if (result.category==='errors') counts.errors++;
      if (result.compactOnly) counts.compactOnly++;
      if (result.linkedButUnretained) counts.linkedButUnretained++;
      if (result.missingCategories.length) counts.missing++;
    }
  }
  const pending=await primary.selectFrom('garmin_activity_identities').select(eb=>eb.fn.countAll<string>().as('count')).where('activity_id','is',null).where('status','!=','rejected').executeTakeFirstOrThrow();
  providers.garmin.pending=Number(pending.count);
  return {dryRun:options.dryRun,processedActivities:batch.length,otherActivities,providers,
    nextCursor:providers.strava.errors || providers.garmin.errors ? options.cursor ?? null : batch.at(-1)?.id ?? options.cursor ?? null,hasMore:rows.length>options.limit,
    nextAction:'Missing rich evidence can be obtained with an optional explicit activity Fetch. Backfill never downloads.',fetched:false as const,scoreWrites:false as const};
}
