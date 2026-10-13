import { BadRequestException, Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ACTIVITY_TYPES, HeatmapRoutesRepository, LEGACY_ACCOUNT_ID, type HeatmapRouteCandidate, type HeatmapRoutesQuery } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { readHeatmapProjectionUpgrades } from './heatmap-projections.js';
import type { ActivityRouteResponse } from '../activities/activity-route.js';
import { assertUuid, parseBoundedInteger, parseDateRange } from '../query-validation.js';
import { encodeRoutePolyline } from '../activities/activity-route-projection.js';
import { stravaSummaryRoute } from '../activities/activity-route.js';

const MAX_PAGE_POINTS = 15_000;
const MAX_PAGE_GEOMETRY_CHARS = 400_000;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;

function invalidQuery(message: string): never {
  throw new BadRequestException({ code: 'INVALID_HEATMAP_QUERY', message });
}

export function encodeHeatmapCursor(date: string, id: string): string {
  return Buffer.from(`v1|${date}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): NonNullable<HeatmapRoutesQuery['cursor']> {
  if (!CURSOR_PATTERN.test(raw)) invalidQuery('Invalid heatmap cursor.');
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const parts = decoded.split('|');
  if (parts.length !== 3 || parts[0] !== 'v1' || encodeHeatmapCursor(parts[1]!, parts[2]!) !== raw) {
    invalidQuery('Invalid heatmap cursor.');
  }
  const [, date, id] = parts;
  try {
    parseDateRange(date, undefined);
    assertUuid(id!, 'INVALID_HEATMAP_CURSOR');
  } catch {
    invalidQuery('Invalid heatmap cursor.');
  }
  return { date: date!, id: id! };
}

export function parseHeatmapQuery(raw: Record<string, unknown>): HeatmapRoutesQuery & { encoding?: 'polyline5' } {
  const keys = ['from', 'to', 'activityType', 'limit', 'cursor', 'encoding'];
  if (Object.keys(raw).some(key => !keys.includes(key))
    || Object.values(raw).some(value => typeof value !== 'string')) {
    invalidQuery('Unsupported heatmap filter.');
  }
  const query = raw as Record<string, string | undefined>;
  if (query.encoding !== undefined && query.encoding !== 'polyline5') invalidQuery('Unknown route encoding.');
  const range = parseDateRange(query.from, query.to);
  if (query.activityType !== undefined && !ACTIVITY_TYPES.includes(query.activityType as typeof ACTIVITY_TYPES[number])) {
    invalidQuery('Unknown canonical activity type.');
  }
  return {
    ...range,
    activityType: query.activityType as HeatmapRoutesQuery['activityType'],
    limit: parseBoundedInteger(query.limit, { name: 'limit', defaultValue: 25, min: 1, max: query.encoding === 'polyline5' ? 200 : 50 }),
    ...(query.encoding === 'polyline5' ? { encoding: 'polyline5' as const } : {}),
    cursor: query.cursor === undefined ? undefined : decodeCursor(query.cursor),
  };
}

/**
 * A page is defined over trusted linked canonical candidates, not returned
 * geometry. Invalid/missing/budgeted routes still advance the cursor.
 */
export function assembleHeatmapRoutes(candidates: HeatmapRouteCandidate[], hasMore: boolean, limit: number,
  upgrades: ReadonlyMap<string, ActivityRouteResponse> = new Map(), encoding?: 'polyline5') {
  const items: Array<{
    activityId: string;
    date: string;
    sport: HeatmapRouteCandidate['sport'];
    source: 'strava' | 'garmin';
    resolution: 'summary' | 'streams' | 'detail' | 'fit';
    geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'MultiLineString'; coordinates: [number, number][][] } | { type: 'LineString' | 'MultiLineString'; polylines: string[] };
  }> = [];
  let missingGps = 0;
  let invalidGeometry = 0;
  let budgetExceeded = 0;
  let points = 0;
  let geometryChars = 0;
  const pointBudget = encoding ? 1_000_000 : MAX_PAGE_POINTS;
  const charBudget = encoding ? 1_600_000 : MAX_PAGE_GEOMETRY_CHARS;
  const geometryFor = (route: Extract<ActivityRouteResponse, { status: 'available' }>) => encoding
    ? { type: route.geometry.type, polylines: (route.geometry.type === 'LineString'
      ? [route.geometry.coordinates] : route.geometry.coordinates).map(encodeRoutePolyline) }
    : route.geometry;
  const quality = { summary: 0, streams: 0, detail: 0, fit: 0 };
  for (const candidate of candidates) {
    const summary = candidate.stravaLinked === false
      ? { status: 'unavailable' as const, reason: 'no_gps' as const }
      : stravaSummaryRoute(candidate.polyline, candidate.polylineType);
    const upgrade = upgrades.get(candidate.activityId);
    let route = upgrade ?? summary;
    if (route.status === 'unavailable') {
      if (route.reason === 'summary_polyline_missing' || route.reason === 'no_gps') missingGps++;
      else invalidGeometry++;
      continue;
    }
    let geometry = geometryFor(route);
    let chars = JSON.stringify(geometry).length;
    // Keep approximate GPS coverage when a large rich route does not fit
    // the remaining page budget, without weakening Strava visibility checks.
    if (upgrade && summary.status === 'available' &&
        (points + route.pointCount > pointBudget || geometryChars + chars > charBudget)) {
      route = summary;
      geometry = geometryFor(route);
      chars = JSON.stringify(geometry).length;
    }
    if (points + route.pointCount > pointBudget || geometryChars + chars > charBudget) {
      budgetExceeded++;
      continue;
    }
    points += route.pointCount;
    geometryChars += chars;
    quality[route.resolution]++;
    items.push({
      activityId: candidate.activityId, date: candidate.date, sport: candidate.sport,
      source: route.source, resolution: route.resolution, geometry,
    });
  }
  const last = candidates[candidates.length - 1];
  return {
    items,
    limit,
    nextCursor: hasMore && last ? encodeHeatmapCursor(last.date, last.activityId) : null,
    hasMore,
    partial: hasMore || missingGps > 0 || invalidGeometry > 0 || budgetExceeded > 0,
    coverage: {
      eligibleScanned: candidates.length,
      usable: items.length,
      missingGps,
      invalidGeometry,
      budgetExceeded,
      quality,
    },
  };
}

@Controller('heatmap')
export class HeatmapController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider,
    @Inject(ActivityDetailDbProvider) private readonly detail?: ActivityDetailDbProvider) {}

  @Get('routes')
  @Header('Cache-Control', 'private, no-store')
  async routes(@Query() raw: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) {
    const { encoding, ...query } = parseHeatmapQuery(raw);
    const owner = account?.id ?? LEGACY_ACCOUNT_ID;
    const result = await this.dbProvider.withAccount(owner,
      db => new HeatmapRoutesRepository(db).list(query));
    // Optional auxiliary DB: a stale/outage/missing migration degrades to
    // trusted summary routes without affecting pagination or ownership.
    const upgrades = this.detail
      ? await readHeatmapProjectionUpgrades(owner, result.candidates, this.detail).catch(() => new Map())
      : new Map();
    return assembleHeatmapRoutes(result.candidates, result.hasMore, query.limit, upgrades, encoding);
  }
}
