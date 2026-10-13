import { ActivityProviderResourcesRepository, ActivityRouteProjectionsRepository,
  type HeatmapRouteCandidate } from '@sportos/db';
import type { ActivityDetailDbProvider } from '../db.provider.js';
import { decodeStoredRoute, ROUTE_ALGORITHM_VERSION } from '../activities/activity-route-projection.js';
import { stravaSummaryRoute, type ActivityRouteResponse } from '../activities/activity-route.js';

/** Read a whole heatmap page in a single auxiliary account context. Never read raw
 * detail payloads here. All eligible IDs and source authority come from primary. */
export async function readHeatmapProjectionUpgrades(owner: string, candidates: HeatmapRouteCandidate[],
  detail: ActivityDetailDbProvider): Promise<Map<string, ActivityRouteResponse>> {
  if (!candidates.length) return new Map();
  if (candidates.length > 50) throw new Error('Heatmap projection page exceeds limit');
  return detail.withAccount(owner, async db => {
    const projections = new ActivityRouteProjectionsRepository(db);
    const rows = await projections.getMany(candidates.map(c => c.activityId));
    const byId = new Map(candidates.map(c => [c.activityId, c]));
    // Only metadata for eligible, current Strava refs; no rich provider fetch.
    const stravaRefs = rows.filter(row => row.provider === 'strava' && byId.get(row.activity_id)?.stravaLinked)
      .map(row => ({ activityId: row.activity_id, providerActivityId: row.source_ref }));
    const garminRefs = rows.filter(row => row.provider === 'garmin' && byId.get(row.activity_id)?.stravaLinked === false)
      .map(row => ({ identityKey: row.source_ref, sourceHash: row.source_version }));
    const [resources, manifests] = await Promise.all([
      new ActivityProviderResourcesRepository(db).metadataMany(stravaRefs),
      projections.availableGarminFits(garminRefs),
    ]);
    const retainedFits = new Set(manifests.map(row => JSON.stringify([row.identityKey, row.sourceHash])));
    const upgrades = new Map<string, ActivityRouteResponse>();
    for (const row of rows) {
      const candidate = byId.get(row.activity_id);
      if (!candidate || row.state !== 'current' || row.algorithm_version !== ROUTE_ALGORITHM_VERSION ||
          !/^[a-f0-9]{64}$/.test(row.resource_hash) || !/^[a-f0-9]{64}$/.test(row.source_version)) continue;
      if (row.provider === 'strava') {
        // Strava visibility MUST be established before decoding rich geometry.
        // The newest available link and the trusted normalized summary must
        // refer to the same version, as in the single-activity map reader.
        if (!candidate.stravaLinked || !candidate.stravaProviderActivityId ||
            candidate.stravaProviderActivityId !== row.source_ref ||
            candidate.trustedProviderActivityId !== row.source_ref ||
            candidate.trustedProviderVersion !== candidate.stravaProviderVersion ||
            candidate.stravaProviderVersion !== row.source_version ||
            stravaSummaryRoute(candidate.polyline, candidate.polylineType).status !== 'available') continue;
        const evidence = resources.find(resource => resource.activityId === row.activity_id &&
          resource.providerActivityId === row.source_ref && resource.resourceType === row.resolution &&
          resource.providerVersion === row.source_version && resource.availability === 'available' &&
          resource.fetchedAt.getTime() === row.source_fetched_at.getTime());
        if (!evidence) continue;
      } else if (row.provider === 'garmin') {
        if (candidate.stravaLinked !== false || candidate.garminIdentityKey !== row.source_ref ||
            candidate.garminCurrentHash !== row.source_version || row.resolution !== 'fit' ||
            !retainedFits.has(JSON.stringify([row.source_ref, row.source_version]))) continue;
      } else continue;
      const route = decodeStoredRoute(row);
      if (route?.status === 'available') upgrades.set(row.activity_id, route);
    }
    return upgrades;
  });
}
