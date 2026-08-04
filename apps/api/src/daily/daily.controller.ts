import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { isIsoDate, LEGACY_ACCOUNT_ID } from '@sportos/db';
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
      limit: parseBoundedInteger(limit, { name: 'limit', defaultValue: 365, min: 1, max: 2000 }),
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
}
