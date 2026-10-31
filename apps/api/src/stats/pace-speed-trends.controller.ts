import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { PaceSpeedTrendsRepository, type PaceSpeedGrain, type PaceSpeedSport, type PaceSpeedTrendQuery } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider } from '../db.provider.js';
import { parseDateRange } from '../query-validation.js';

const FIELDS = new Set(['from', 'to', 'sport', 'granularity', 'threshold']);
const SPORTS = ['run', 'bike', 'swim'];
const GRAINS = ['daily', 'weekly', 'monthly'];

export function parsePaceSpeedQuery(raw: Record<string, unknown>): PaceSpeedTrendQuery {
  if (Object.keys(raw).some(key => !FIELDS.has(key)) ||
    Object.values(raw).some(value => typeof value !== 'string')) {
    throw new BadRequestException({ code: 'INVALID_PACE_SPEED_QUERY', message: 'Unsupported or repeated query parameter.' });
  }
  const params = raw as Record<string, string | undefined>;
  const range = parseDateRange(params.from, params.to, { required: true, maxDays: 3660 });
  const sport = params.sport ?? 'run';
  const granularity = params.granularity ?? 'weekly';
  if (!SPORTS.includes(sport) || !GRAINS.includes(granularity)) {
    throw new BadRequestException({ code: 'INVALID_PACE_SPEED_QUERY', message: 'Unknown sport or chart granularity.' });
  }
  const maxThreshold = sport === 'bike' ? 150 : 1800;
  const threshold = params.threshold === undefined ? null : Number(params.threshold);
  if (threshold !== null && (!Number.isFinite(threshold) || threshold < 1 || threshold > maxThreshold)) {
    throw new BadRequestException({ code: 'INVALID_PACE_SPEED_QUERY', message: 'Threshold must be a finite positive value within the sport limit.' });
  }
  return {
    from: range.from!,
    to: range.to!,
    sport: sport as PaceSpeedSport,
    granularity: granularity as PaceSpeedGrain,
    threshold,
  };
}

@Controller('stats')
export class PaceSpeedTrendsController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  @Get('pace-speed')
  trends(@Query() raw: Record<string, unknown>, @CurrentAccount() account: AuthenticatedAccount) {
    const query = parsePaceSpeedQuery(raw);
    return this.dbProvider.withAccount(account.id, db => new PaceSpeedTrendsRepository(db).read(query));
  }
}
