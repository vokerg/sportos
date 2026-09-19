import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { ACTIVITY_SOURCES, ACTIVITY_TYPES, ActivitiesRepository, LEGACY_ACCOUNT_ID, type ActivitiesQuery } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider } from '../db.provider.js';
import { assertUuid, parseBoundedInteger, parseDateRange } from '../query-validation.js';

function boundedPositive(value: string | undefined, name: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITY_METRIC_FILTER', message: `${name} must be greater than zero and at most ${max}.` });
  }
  return number;
}

export function parseActivitiesQuery(raw: Record<string, unknown>): ActivitiesQuery {
  const allowed = new Set(['from', 'to', 'activityType', 'source', 'minDistanceM', 'paceUnderSPerKm', 'minAvgSpeedMps', 'swimPaceUnderSPer100m', 'limit', 'offset']);
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
  const minDistanceM = boundedPositive(query.minDistanceM, 'minDistanceM', 1_000_000);
  const paceUnderSPerKm = boundedPositive(query.paceUnderSPerKm, 'paceUnderSPerKm', 3_600);
  const minAvgSpeedMps = boundedPositive(query.minAvgSpeedMps, 'minAvgSpeedMps', 100);
  const swimPaceUnderSPer100m = boundedPositive(query.swimPaceUnderSPer100m, 'swimPaceUnderSPer100m', 3_600);
  if ((minDistanceM !== undefined && !['run', 'bike', 'swim'].includes(query.activityType ?? ''))
    || (paceUnderSPerKm !== undefined && query.activityType !== 'run')
    || (minAvgSpeedMps !== undefined && query.activityType !== 'bike')
    || (swimPaceUnderSPer100m !== undefined && query.activityType !== 'swim')) {
    throw new BadRequestException({ code: 'INVALID_ACTIVITY_METRIC_FILTER', message: 'Metric filters require the matching activity type.' });
  }
  return {
    ...range,
    activityType: query.activityType as ActivitiesQuery['activityType'],
    source: query.source as ActivitiesQuery['source'],
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
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

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
}
