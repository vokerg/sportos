import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  CockpitRepository,
  DailyRepository,
  ScoreBreakdownContractError,
  parseDailyScoreBreakdown,
  type DailyScoreBreakdown,
  type DailyScoreBreakdownReadModel,
  type DailySummaryQuery,
} from '@sportos/db';
import { DbProvider } from '../db.provider.js';

@Injectable()
export class DailyService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  async summary(input: DailySummaryQuery) {
    return new CockpitRepository(this.dbProvider.db).listDailySummary(input);
  }

  async scoreBreakdown(metricDate: string): Promise<DailyScoreBreakdown | null> {
    const result: DailyScoreBreakdownReadModel | null = await new DailyRepository(this.dbProvider.db)
      .getDailyScoreBreakdown(metricDate);
    if (result === null) return null;

    try {
      return parseDailyScoreBreakdown(result);
    } catch (error) {
      if (error instanceof ScoreBreakdownContractError) {
        throw new InternalServerErrorException({
          code: 'SCORE_BREAKDOWN_INCONSISTENT',
          message: 'The persisted score breakdown failed consistency checks.',
          date: metricDate,
        });
      }
      throw error;
    }
  }
}
