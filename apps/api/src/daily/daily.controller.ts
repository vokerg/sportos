import { Controller, Get, Query } from '@nestjs/common';
import { DailyRepository } from '@sportos/db';
import { DbProvider } from '../db.provider.js';

@Controller('daily')
export class DailyController {
  constructor(private readonly dbProvider: DbProvider) {}

  @Get('summary')
  async summary(@Query('limit') limit?: string) {
    const repo = new DailyRepository(this.dbProvider.db);
    return repo.listDailySummary(limit ? Number(limit) : 90);
  }
}
