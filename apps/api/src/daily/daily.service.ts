import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  CockpitRepository,
  type DailyEvidenceReadModel,
  DailyRepository,
  DailyScoringRepository,
  DynamicsRepository,
  LEGACY_ACCOUNT_ID,
  ScoreBreakdownContractError,
  parseDailyScoreBreakdown,
  parseDailyEvidence,
  type DailyScoreBreakdown,
  type DailyScoreBreakdownReadModel,
  type DailySummaryQuery,
  type ManualDailyFactsInput,
  type ScoreContributionActivityType,
} from '@sportos/db';
import { DbProvider } from '../db.provider.js';

@Injectable()
export class DailyService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  summary(input: DailySummaryQuery, accountId = LEGACY_ACCOUNT_ID) {
    return this.dbProvider.withAccount(accountId, async (db) => {
      const summaries = await new CockpitRepository(db).listDailySummary(input);
      if (summaries.length === 0) return summaries;

      const dates = summaries.map((row) => row.metric_date);
      const contributionRows = await new DynamicsRepository(db).listScoreContributions(
        dates.reduce((earliest, date) => date < earliest ? date : earliest),
        dates.reduce((latest, date) => date > latest ? date : latest),
        { importedFallback: 'unattributed' },
      );
      const contributionsByDate = new Map<string, Partial<Record<ScoreContributionActivityType, number>>>();
      for (const contribution of contributionRows) {
        const byCategory = contributionsByDate.get(contribution.metricDate) ?? {};
        byCategory[contribution.activityType] = (byCategory[contribution.activityType] ?? 0) + contribution.points;
        contributionsByDate.set(contribution.metricDate, byCategory);
      }

      return summaries.map((row) => {
        const scoreContributions = contributionsByDate.get(row.metric_date) ?? {};
        const attributedTotal = Object.values(scoreContributions).reduce((sum, points) => sum + (points ?? 0), 0);
        const remainder = Number(row.total_points) - attributedTotal;
        if (remainder !== 0) {
          scoreContributions.unattributed = (scoreContributions.unattributed ?? 0) + remainder;
        }
        return { ...row, score_contributions: scoreContributions };
      });
    });
  }

  manualFacts(input: DailySummaryQuery, accountId = LEGACY_ACCOUNT_ID) {
    return this.dbProvider.withAccount(accountId, (db) => new DailyRepository(db).listManualDailyFacts(input));
  }

  async evidence(metricDate: string, accountId = LEGACY_ACCOUNT_ID): Promise<DailyEvidenceReadModel> {
    const result = await this.dbProvider.withAccount(
      accountId,
      (db) => new DailyRepository(db).getDailyEvidence(metricDate),
    );
    try {
      return parseDailyEvidence(result);
    } catch (error) {
      if (error instanceof ScoreBreakdownContractError) {
        throw new InternalServerErrorException({
          code: 'DAILY_EVIDENCE_INCONSISTENT',
          message: 'The dated source evidence failed consistency checks.',
          date: metricDate,
        });
      }
      throw error;
    }
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

  async saveManualFacts(
    metricDate: string,
    input: ManualDailyFactsInput,
    accountId = LEGACY_ACCOUNT_ID,
  ): Promise<DailyScoreBreakdown> {
    const result = await this.dbProvider.withAccount(
      accountId,
      (db) => new DailyScoringRepository(db).saveManualFacts(metricDate, input),
    );
    try {
      return parseDailyScoreBreakdown(result);
    } catch (error) {
      if (error instanceof ScoreBreakdownContractError) {
        throw new InternalServerErrorException({
          code: 'SCORE_BREAKDOWN_INCONSISTENT',
          message: 'The manually saved score breakdown failed consistency checks.',
          date: metricDate,
        });
      }
      throw error;
    }
  }

  runningStepEstimate(metricDate: string, accountId = LEGACY_ACCOUNT_ID) {
    return this.dbProvider.withAccount(
      accountId,
      (db) => new DailyScoringRepository(db).runningStepEstimate(metricDate),
    );
  }
}
