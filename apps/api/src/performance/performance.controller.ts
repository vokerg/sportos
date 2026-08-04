import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID, PerformanceRepository } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider } from '../db.provider.js';
import {
  assertUuid,
  parseBoundedInteger,
  parseDateRange,
  parseOptionalPositiveNumber,
  parsePositiveNumber,
} from '../query-validation.js';

@Controller('performance')
export class PerformanceController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  @Get('best')
  async best(
    @Query('distanceM') distanceM?: string,
    @Query('limit') limit?: string,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    return this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, (db) => new PerformanceRepository(db).listBestByDistance(
      parsePositiveNumber(distanceM, { name: 'distanceM', defaultValue: 5000 }),
      parseBoundedInteger(limit, { name: 'limit', defaultValue: 25, min: 1, max: 200 }),
    ));
  }

  @Get('events')
  async events(
    @Query('distanceM') distanceM?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @CurrentAccount() account?: AuthenticatedAccount,
  ) {
    const range = parseDateRange(from, to, { maxDays: 3660 });
    return this.dbProvider.withAccount(account?.id ?? LEGACY_ACCOUNT_ID, (db) => new PerformanceRepository(db).listEvents({
      ...range,
      distanceM: parseOptionalPositiveNumber(distanceM, 'distanceM'),
      limit: parseBoundedInteger(limit, { name: 'limit', defaultValue: 100, min: 1, max: 500 }),
    }));
  }

  @Get('events/:eventId')
  async event(@Param('eventId') eventId: string, @CurrentAccount() account?: AuthenticatedAccount) {
    assertUuid(eventId, 'INVALID_PERFORMANCE_EVENT_ID');
    const result = await this.dbProvider.withAccount(
      account?.id ?? LEGACY_ACCOUNT_ID,
      (db) => new PerformanceRepository(db).getEventDetail(eventId),
    );
    if (!result) {
      throw new NotFoundException({ code: 'PERFORMANCE_EVENT_NOT_FOUND', message: 'Performance event was not found.' });
    }
    return result;
  }
}
