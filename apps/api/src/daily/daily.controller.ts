import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { IsoDateSchema } from '@sportos/db';
import { DailyService } from './daily.service.js';

@Controller('daily')
export class DailyController {
  constructor(@Inject(DailyService) private readonly dailyService: DailyService) {}

  @Get('summary')
  async summary(@Query('limit') limit?: string) {
    return this.dailyService.summary(limit ? Number(limit) : 90);
  }

  @Get(':date/score-breakdown')
  async scoreBreakdown(@Param('date') date: string) {
    const parsedDate = IsoDateSchema.safeParse(date);
    if (!parsedDate.success) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Date must be a real calendar date in YYYY-MM-DD format.',
        date,
      });
    }

    const result = await this.dailyService.scoreBreakdown(parsedDate.data);
    if (result === null) {
      throw new NotFoundException({
        code: 'DAILY_SCORE_NOT_FOUND',
        message: `No persisted daily score exists for ${parsedDate.data}.`,
        date: parsedDate.data,
      });
    }
    return result;
  }
}
