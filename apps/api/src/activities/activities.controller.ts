import { stravaSummaryRoute, type ActivityRouteResponse } from './activity-route.js';
import { ActivityRouteProjectionService } from './activity-route-projection.service.js';
import { RunningEffortsService } from './running-efforts.service.js';
import { ActivityMetricsService } from './activity-metrics.service.js';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import {
  ACTIVITY_SOURCES,
  ACTIVITY_TYPES,
  ActivitiesRepository,
  ActivityDistanceCorrectionConflictError,
  ActivityDistanceCorrectionNoChangeError,
  ActivityDistanceCorrectionUnsupportedError,
  LEGACY_ACCOUNT_ID,
  type ActivitiesQuery,
} from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider } from '../db.provider.js';
import { assertUuid, parseBoundedInteger, parseDateRange } from '../query-validation.js';
import { ActivityProviderDetailService } from './activity-provider-detail.service.js';
import { ActivityDistanceCorrectionService } from './activity-distance-correction.service.js';

function boundedPositive(value: string | undefined, name: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITY_METRIC_FILTER', message: `${name} must be greater than zero and at most ${max}.` });
  }
  return number;
}

export function parseActivitiesQuery(raw: Record<string, unknown>): ActivitiesQuery {
  const allowed = new Set(['from', 'to', 'activityType', 'source', 'subtype', 'minDistanceM', 'paceUnderSPerKm', 'minAvgSpeedMps', 'swimPaceUnderSPer100m', 'limit', 'offset']);
  if (Object.keys(raw).some((key) => !allowed.has(key)) || Object.values(raw).some((value) => typeof value !== 'string')) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITIES_QUERY', message: 'Unsupported activities filter.' });
  }
  const query = raw as Record<string, string | undefined>;
  const range = parseDateRange(query.from, query.to);
  if (query.activityType && !ACTIVITY_TYPES.includes(query.activityType as typeof ACTIVITY_TYPES[number])) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITY_TYPE', message: 'Unknown activity type.' });
  }
  if (query.source && !ACTIVITY_SOURCES.includes(query.source as typeof ACTIVITY_SOURCES[number])) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITY_SOURCE', message: 'Unknown activity source.' });
  }
  const subtype = query.subtype as ActivitiesQuery['subtype'];
  if (subtype && !['treadmill', 'track', 'outdoor'].includes(subtype)) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITY_SUBTYPE', message: 'Unknown activity subtype.' });
  }
  const minDistanceM = boundedPositive(query.minDistanceM, 'minDistanceM', 1_000_000);
  const paceUnderSPerKm = boundedPositive(query.paceUnderSPerKm, 'paceUnderSPerKm', 3_600);
  const minAvgSpeedMps = boundedPositive(query.minAvgSpeedMps, 'minAvgSpeedMps', 100);
  const swimPaceUnderSPer100m = boundedPositive(query.swimPaceUnderSPer100m, 'swimPaceUnderSPer100m', 3_600);
  if ((subtype !== undefined && query.activityType !== 'run')
    || (minDistanceM !== undefined && !['walk', 'run', 'bike', 'swim'].includes(query.activityType ?? ''))
    || (paceUnderSPerKm !== undefined && query.activityType !== 'run')
    || (minAvgSpeedMps !== undefined && query.activityType !== 'bike')
    || (swimPaceUnderSPer100m !== undefined && query.activityType !== 'swim')) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITY_METRIC_FILTER', message: 'Metric filters require the matching activity type.' });
  }
  return {
    ...range,
    activityType: query.activityType as ActivitiesQuery['activityType'],
    source: query.source as ActivitiesQuery['source'],
    subtype,
    minDistanceM,
    paceUnderSPerKm,
    minAvgSpeedMps,
    swimPaceUnderSPer100m,
    limit: parseBoundedInteger(query.limit, { name: 'limit', defaultValue: 50, min: 1, max: 100 }),
    offset: parseBoundedInteger(query.offset, { name: 'offset', defaultValue: 0, min: 0, max: 100000 }),
  };
}

@Controller('activities')
export class ActivitiesController {
  constructor(
    @Inject(DbProvider) private readonly dbProvider: DbProvider,
    private readonly providerDetailService: ActivityProviderDetailService,
    private readonly metrics?: ActivityMetricsService,
    private readonly efforts?: RunningEffortsService,
    private readonly routes?: ActivityRouteProjectionService,
    private readonly distanceCorrections?: ActivityDistanceCorrectionService,
  ) {}

  @Get()
  async list(@Query() raw: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) {
    const query = parseActivitiesQuery(raw);
    return this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, (db) => new ActivitiesRepository(db).list(query));
  }

  @Get(':activityId')
  async detail(@Param('activityId') activityId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    const activity = await this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, (db) => new ActivitiesRepository(db).get(activityId));
    if (!activity) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity was not found.' });
    return activity;
  }

  @Put(':activityId/distance-correction')
  async saveDistanceCorrection(
    @Param('activityId') activityId: string,
    @Body() body: unknown,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    const input = parseDistanceCorrectionBody(body);
    try {
      const result = await this.distanceCorrections!.save(
        account?.id ?? LEGACY_ACCOUNT_ID,
        activityId,
        input.effectiveDistanceM,
        input.reason,
        input.expectedRevision,
      );
      if (!result) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity was not found.' });
      return { activityId, ...result };
    } catch (error) {
      throw mapDistanceCorrectionError(error);
    }
  }

  @Delete(':activityId/distance-correction')
  async resetDistanceCorrection(
    @Param('activityId') activityId: string,
    @Body() body: unknown,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    const expectedRevision = parseExpectedCorrectionRevision(body, 'reset');
    try {
      const result = await this.distanceCorrections!.reset(account?.id ?? LEGACY_ACCOUNT_ID, activityId, expectedRevision);
      if (!result) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity was not found.' });
      return { activityId, ...result };
    } catch (error) {
      throw mapDistanceCorrectionError(error);
    }
  }

  @Get(':activityId/provider-detail')
  async providerDetail(@Param('activityId') activityId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    return this.providerDetailService.cached(account?.id ?? LEGACY_ACCOUNT_ID, activityId);
  }

  @Post(':activityId/provider-detail')
  async fetchProviderDetail(@Param('activityId') activityId: string, @Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    const input = body ?? {};
    if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'refresh') || ('refresh' in input && typeof input.refresh !== 'boolean')) throw new BadRequestException('Invalid provider fetch request.');
    return this.providerDetailService.load(account?.id ?? LEGACY_ACCOUNT_ID, activityId, 'refresh' in input && input.refresh === true);
  }

  @Post(':activityId/metrics/reprocess')
  async reprocess(@Param('activityId') activityId: string, @Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new BadRequestException('Retained reprocessing accepts no fields.');
    const owner = account?.id ?? LEGACY_ACCOUNT_ID;
    const activity = await this.dbProvider.withAccount(owner, db => new ActivitiesRepository(db).get(activityId));
    if (!activity) throw new NotFoundException({code:'ACTIVITY_NOT_FOUND',message:'Activity was not found.'});
    return {metricProjection: await this.metrics!.project(owner,activityId)};
  }

  @Post(':activityId/efforts/reprocess')
  async reprocessEfforts(@Param('activityId') activityId: string, @Body() body: unknown, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new BadRequestException('Retained effort processing accepts no fields.');
    const owner = account?.id ?? LEGACY_ACCOUNT_ID;
    const activity = await this.dbProvider.withAccount(owner, db => db.selectFrom('activities').select('activity_type').where('id', '=', activityId).executeTakeFirst());
    if (!activity) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity was not found.' });
    if (activity.activity_type !== 'run') throw new BadRequestException('Running efforts require a run.');
    return { effortProjection: await this.efforts!.project(owner, activityId) };
  }


  @Get(':activityId/map')
  async map(@Param('activityId') activityId: string, @CurrentAccount() account?: AuthenticatedAccount): Promise<ActivityRouteResponse> {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    if (this.routes) return this.routes.read(account?.id ?? LEGACY_ACCOUNT_ID,activityId);
    const evidence = await this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, db =>
      new ActivitiesRepository(db).getStravaRouteEvidence(activityId));
    if (!evidence) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity was not found.' });
    if (!evidence.linked) return { status: 'unavailable', reason: 'no_gps' };
    return stravaSummaryRoute(evidence.polyline, evidence.polylineType);
  }

  @Post(':activityId/map/reprocess')
  async reprocessMap(@Param('activityId') activityId:string,@Body() body:unknown,@CurrentAccount() account?:AuthenticatedAccount){
    assertUuid(activityId,'INVALID_ACTIVITY_ID');
    if(body!==undefined&&body!==null&&(typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)) throw new BadRequestException('Retained route reprocessing accepts no fields.');
    return {routeProjection:await this.routes!.project(account?.id??LEGACY_ACCOUNT_ID,activityId)};
  }

  @Get(':activityId/source')
  async sourceJson(@Param('activityId') activityId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(activityId, 'INVALID_ACTIVITY_ID');
    const source = await this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, (db) => new ActivitiesRepository(db).getSourceJson(activityId));
    if (!source) throw new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity was not found.' });
    return source;
  }
}

export interface ParsedDistanceCorrectionBody {
  effectiveDistanceM: number;
  reason: string;
  expectedRevision: number | null;
}

export function parseDistanceCorrectionBody(raw: unknown): ParsedDistanceCorrectionBody {
  const body = requireCorrectionObject(raw, 'save');
  const allowed = new Set(['effectiveDistanceM', 'reason', 'expectedRevision']);
  if (Object.keys(body).some((key) => !allowed.has(key))) invalidCorrectionBody('Unsupported distance correction field.');
  if (typeof body.effectiveDistanceM !== 'number' || !Number.isFinite(body.effectiveDistanceM)
    || body.effectiveDistanceM <= 0 || body.effectiveDistanceM > 1_000_000
    || Math.abs(body.effectiveDistanceM * 100 - Math.round(body.effectiveDistanceM * 100)) > 1e-7) {
    invalidCorrectionBody('effectiveDistanceM must be a positive number with at most two decimal places and at most 1000000.');
  }
  if (typeof body.reason !== 'string' || body.reason.trim().length < 1 || body.reason.trim().length > 500) {
    invalidCorrectionBody('reason must contain 1 through 500 non-whitespace characters.');
  }
  return {
    effectiveDistanceM: body.effectiveDistanceM,
    reason: body.reason.trim(),
    expectedRevision: parseExpectedCorrectionRevision(body, 'save'),
  };
}

function parseExpectedCorrectionRevision(raw: unknown, operation: 'save' | 'reset'): number | null {
  if (raw === undefined || raw === null) return null;
  const body = requireCorrectionObject(raw, operation);
  if (operation === 'reset' && Object.keys(body).some((key) => key !== 'expectedRevision')) {
    invalidCorrectionBody('Unsupported distance correction field.');
  }
  const value = body.expectedRevision;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalidCorrectionBody('expectedRevision must be a non-negative integer or null.');
  }
  return value;
}

function requireCorrectionObject(raw: unknown, operation: 'save' | 'reset'): Record<string, unknown> {
  if (raw === undefined || raw === null) {
    if (operation === 'reset') return {};
    invalidCorrectionBody('A distance correction body is required.');
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) invalidCorrectionBody('Distance correction body must be an object.');
  return raw as Record<string, unknown>;
}

function invalidCorrectionBody(message: string): never {
  throw new BadRequestException({ code: 'INVALID_ACTIVITY_DISTANCE_CORRECTION', message });
}

function mapDistanceCorrectionError(error: unknown): never {
  if (error instanceof ActivityDistanceCorrectionConflictError) {
    throw new ConflictException({ code: error.code, message: error.message });
  }
  if (error instanceof ActivityDistanceCorrectionUnsupportedError || error instanceof ActivityDistanceCorrectionNoChangeError) {
    throw new BadRequestException({ code: error.code, message: error.message });
  }
  throw error;
}
