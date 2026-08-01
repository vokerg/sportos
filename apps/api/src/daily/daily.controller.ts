import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { isIsoDate } from '@sportos/db';
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
  ) {
    const range = parseDateRange(from, to, { maxDays: 3660 });
    return this.dailyService.summary({
      ...range,
      limit: parseBoundedInteger(limit, { name: 'limit', defaultValue: 365, min: 1, max: 2000 }),
    });
  }

  @Get(':date/score-breakdown')
  async scoreBreakdown(@Param('date') date: string) {
    if (!isIsoDate(date)) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Date must be a real calendar date in YYYY-MM-DD format.',
        date,
      });
    }

    const result = await this.dailyService.scoreBreakdown(date);
    if (result === null) {
      throw new NotFoundException({
        code: 'DAILY_SCORE_NOT_FOUND',
        message: `No persisted daily score exists for ${date}.`,
        date,
      });
    }
    return result;
  }
}
