import { Controller, Get, Inject, Query } from '@nestjs/common';
import { PerformanceRepository } from '@sportos/db';
import { DbProvider } from '../db.provider.js';

@Controller('performance')
export class PerformanceController {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  @Get('best')
  async best(@Query('distanceM') distanceM = '5000', @Query('limit') limit = '25') {
    const repo = new PerformanceRepository(this.dbProvider.db);
    return repo.listBestByDistance(Number(distanceM), Number(limit));
  }
}
