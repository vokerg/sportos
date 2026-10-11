import type { Kysely } from 'kysely';
import type { Database } from './schema.js';
import type { DetailExecutor } from './activity-metric-projector.js';
import { validateMetricBackfillOptions, type MetricBackfillOptions } from './activity-metric-backfill.js';
import { RetainedRunningEffortProjector } from './running-effort-projector.js';
/** One bounded, owner-scoped cursor batch. Retry the same cursor on any error. */
export async function backfillRetainedRunningEfforts(primary: Kysely<Database>, detail: DetailExecutor, options: MetricBackfillOptions) {
  validateMetricBackfillOptions(options);
  let query = primary.selectFrom('activities').select('id').where('activity_type', '=', 'run').orderBy('id');
  if (options.cursor) query = query.where('id', '>', options.cursor);
  const rows = await query.limit(options.limit + 1).execute(), batch = rows.slice(0, options.limit);
  const providers = { strava: counts(), garmin: counts() }; const projector = new RetainedRunningEffortProjector(primary, detail);
  for (const activity of batch) {
    let results = await projector.project(activity.id, options.dryRun);
    for (let retry = 0; retry < (options.retries ?? 1) && results.some(r => r.category === 'errors'); retry++) {
      for (const failed of results.filter(r => r.category === 'errors')) {
        const retried = await projector.project(activity.id, options.dryRun, failed.provider);
        results = results.map(r => r.provider === failed.provider ? retried[0] ?? r : r);
      }
    }
    for (const result of results) {
      const count = providers[result.provider]; count[result.category]++;
      for (const reason of result.reasons) count.reasons[reason] = (count.reasons[reason] ?? 0) + 1;
    }
  }
  const errors = providers.strava.errors + providers.garmin.errors + providers.strava.stale + providers.garmin.stale;
  return { dryRun: options.dryRun, processedActivities: batch.length, providers,
    nextCursor: errors ? options.cursor ?? null : batch.at(-1)?.id ?? options.cursor ?? null,
    hasMore: rows.length > options.limit, fetched: false as const, scoreWrites: false as const };
}
function counts() { return { newly_projected: 0, already_current: 0, eligible: 0, stale: 0, errors: 0, reasons: {} as Record<string, number> }; }
