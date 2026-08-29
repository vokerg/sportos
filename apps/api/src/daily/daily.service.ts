import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  CockpitRepository,
  DailyRepository,
  DailyScoringRepository,
  LEGACY_ACCOUNT_ID,
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

  summary(input: DailySummaryQuery, accountId = LEGACY_ACCOUNT_ID) {
    return this.dbProvider.withAccount(accountId, (db) => new CockpitRepository(db).listDailySummary(input));
  }

  async scoreBreakdown(metricDate: string, accountId = LEGACY_ACCOUNT_ID): Promise<DailyScoreBreakdown | null> {
    const result: DailyScoreBreakdownReadModel | null = await this.dbProvider.withAccount(
      accountId,
      (db) => new DailyRepository(db).getDailyScoreBreakdown(metricDate),
    );
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

  async recalculateFromActivities(metricDate: string, accountId = LEGACY_ACCOUNT_ID): Promise<DailyScoreBreakdown> {
    const result: DailyScoreBreakdownReadModel = await this.dbProvider.withAccount(
      accountId,
      (db) => new DailyScoringRepository(db).recalculateFromActivities(metricDate),
    );

    try {
      return parseDailyScoreBreakdown(result);
    } catch (error) {
      if (error instanceof ScoreBreakdownContractError) {
        throw new InternalServerErrorException({
          code: 'SCORE_BREAKDOWN_INCONSISTENT',
          message: 'The recalculated score breakdown failed consistency checks.',
          date: metricDate,
        });
      }
      throw error;
    }
  }
}
