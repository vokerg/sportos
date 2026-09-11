import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { DailyRecalculationUnavailableError, isIsoDate, LEGACY_ACCOUNT_ID, type ManualDailyFactsInput } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { parseBoundedInteger, parseDateRange } from '../query-validation.js';
import { DailyService } from './daily.service.js';

@Controller('daily')
export class DailyController {
  constructor(@Inject(DailyService) private readonly dailyService: DailyService) {}

  @Get('summary')
  async summary(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    const range = parseDateRange(from, to, { maxDays: 3660 });
    return this.dailyService.summary({
      ...range,
      limit: parseBoundedInteger(limit, { name: 'limit', defaultValue: 365, min: 1, max: 10_000 }),
    }, account?.id ?? LEGACY_ACCOUNT_ID);
  }

  @Get(':date/score-breakdown')
  async scoreBreakdown(@Param('date') date: string, @CurrentAccount() account?: AuthenticatedAccount) {
    if (!isIsoDate(date)) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Date must be a real calendar date in YYYY-MM-DD format.',
        date,
      });
    }

    const result = await this.dailyService.scoreBreakdown(date, account?.id ?? LEGACY_ACCOUNT_ID);
    if (result === null) {
      throw new NotFoundException({
        code: 'DAILY_SCORE_NOT_FOUND',
        message: 'No persisted daily score exists for the selected date.',
        date,
      });
    }
    return result;
  }

  @Post(':date/recalculate')
  async recalculate(@Param('date') date: string, @CurrentAccount() account?: AuthenticatedAccount) {
    if (!isIsoDate(date)) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Date must be a real calendar date in YYYY-MM-DD format.',
        date,
      });
    }

    try {
      return await this.dailyService.recalculateFromActivities(date, account?.id ?? LEGACY_ACCOUNT_ID);
    } catch (error) {
      if (error instanceof DailyRecalculationUnavailableError) {
        throw new ConflictException({
          code: 'STRAVA_DATA_UNAVAILABLE',
          message: 'No Strava activity is available for the selected date.',
          date,
        });
      }
      throw error;
    }
  }

  @Put(':date/facts')
  async saveManualFacts(
    @Param('date') date: string,
    @Body() body: unknown,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    if (!isIsoDate(date)) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Date must be a real calendar date in YYYY-MM-DD format.',
        date,
      });
    }
    return this.dailyService.saveManualFacts(date, parseManualDailyFacts(body), account?.id ?? LEGACY_ACCOUNT_ID);
  }
}

const MANUAL_FACT_FIELDS = [
  'steps', 'runIndoorM', 'runOutdoorM', 'runUnspecifiedM', 'bikeIndoorM', 'bikeOutdoorM', 'bikeUnspecifiedM',
  'swimM', 'workoutPoints', 'powerPoints',
] as const;

function parseManualDailyFacts(value: unknown): ManualDailyFactsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidManualFacts();
  const record = value as Record<string, unknown>;
  const unknownFields = Object.keys(record).filter((key) => !MANUAL_FACT_FIELDS.includes(key as typeof MANUAL_FACT_FIELDS[number]));
  if (unknownFields.length > 0) invalidManualFacts(`Unknown field: ${unknownFields[0]}.`);

  const input = Object.fromEntries(MANUAL_FACT_FIELDS.map((field) => {
    const rawValue = record[field];
    const value = rawValue === undefined && (field === 'runUnspecifiedM' || field === 'bikeUnspecifiedM') ? 0 : rawValue;
    return [field, boundedNumber(value, field)];
  })) as Record<typeof MANUAL_FACT_FIELDS[number], number>;
  for (const field of ['steps', 'workoutPoints', 'powerPoints'] as const) {
    if (!Number.isInteger(input[field])) invalidManualFacts(`${field} must be a whole number.`);
  }
  return input;
}

function boundedNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
    invalidManualFacts(`${field} must be a finite number from 0 to 10000000.`);
  }
  return value as number;
}

function invalidManualFacts(detail = 'All canonical fact fields are required.'): never {
  throw new BadRequestException({
    code: 'INVALID_MANUAL_DAILY_FACTS',
    message: detail,
  });
}
