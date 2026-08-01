import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { PerformanceRepository } from '@sportos/db';
import { DbProvider } from '../db.provider.js';
import {
  assertUuid,
  parseBoundedInteger,
  parseDateRange,
  parseOptionalPositiveNumber,
} from '../query-validation.js';

@Controller('performance')
export class PerformanceController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  @Get('best')
  async best(@Query('distanceM') distanceM = '5000', @Query('limit') limit?: string) {
    const distance = parseOptionalPositiveNumber(distanceM, 'distanceM');
    return new PerformanceRepository(this.dbProvider.db).listBestByDistance(
      distance!,
      parseBoundedInteger(limit, { name: 'limit', defaultValue: 25, min: 1, max: 200 }),
    );
  }

  @Get('events')
  async events(
    @Query('distanceM') distanceM?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const range = parseDateRange(from, to, { maxDays: 3660 });
    return new PerformanceRepository(this.dbProvider.db).listEvents({
      ...range,
      distanceM: parseOptionalPositiveNumber(distanceM, 'distanceM'),
      limit: parseBoundedInteger(limit, { name: 'limit', defaultValue: 100, min: 1, max: 500 }),
    });
  }

  @Get('events/:eventId')
  async event(@Param('eventId') eventId: string) {
    assertUuid(eventId, 'INVALID_PERFORMANCE_EVENT_ID');
    const result = await new PerformanceRepository(this.dbProvider.db).getEventDetail(eventId);
    if (!result) {
      throw new NotFoundException({
        code: 'PERFORMANCE_EVENT_NOT_FOUND',
        message: 'Performance event was not found.',
        eventId,
      });
    }
    return result;
  }
}
