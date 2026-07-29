import { Inject, Injectable } from '@nestjs/common';
import { DailyRepository, type DailyScoreBreakdownReadModel } from '@sportos/db';
import { DailyScoreBreakdownSchema, type DailyScoreBreakdown } from '@sportos/shared';
import { DbProvider } from '../db.provider.js';

@Injectable()
export class DailyService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  async summary(limit: number) {
    return new DailyRepository(this.dbProvider.db).listDailySummary(limit);
  }

  async scoreBreakdown(metricDate: string): Promise<DailyScoreBreakdown | null> {
    const result: DailyScoreBreakdownReadModel | null = await new DailyRepository(this.dbProvider.db)
      .getDailyScoreBreakdown(metricDate);
    return result === null ? null : DailyScoreBreakdownSchema.parse(result);
  }
}
