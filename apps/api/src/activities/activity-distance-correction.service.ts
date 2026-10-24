import { Inject, Injectable } from '@nestjs/common';
import {
  ActivityDistanceCorrectionsRepository,
  DailyScoringRepository,
  type Database,
  type Kysely,
  type ActivityDistanceCorrectionPublic,
} from '@sportos/db';
import { DbProvider } from '../db.provider.js';

export interface ActivityDistanceCorrectionResult {
  activityDate: string;
  correction: ActivityDistanceCorrectionPublic | null;
  changed: boolean;
  dailyRecalculated: boolean;
}

/** Owns the transaction boundary for an audited distance correction. The
 * correction and a calculated day's replacement score must commit together;
 * manual/imported days deliberately remain authoritative and are not rewritten.
 */
@Injectable()
export class ActivityDistanceCorrectionService {
  constructor(@Inject(DbProvider) private readonly dbProvider: DbProvider) {}

  save(
    accountId: string,
    activityId: string,
    effectiveDistanceM: number,
    reason: string,
    expectedRevision: number | null,
  ): Promise<ActivityDistanceCorrectionResult | null> {
    return this.dbProvider.withAccount(accountId, (db) => db.transaction().execute(async (transaction) => {
      const mutation = await new ActivityDistanceCorrectionsRepository(transaction)
        .save(activityId, effectiveDistanceM, reason, expectedRevision);
      if (!mutation) return null;
      const dailyRecalculated = await this.recalculateCalculatedDay(transaction, mutation.activityDate, mutation.changed);
      return { ...mutation, dailyRecalculated };
    }));
  }

  reset(
    accountId: string,
    activityId: string,
    expectedRevision: number | null,
  ): Promise<ActivityDistanceCorrectionResult | null> {
    return this.dbProvider.withAccount(accountId, (db) => db.transaction().execute(async (transaction) => {
      const mutation = await new ActivityDistanceCorrectionsRepository(transaction)
        .reset(activityId, expectedRevision);
      if (!mutation) return null;
      const dailyRecalculated = await this.recalculateCalculatedDay(transaction, mutation.activityDate, mutation.changed);
      return { ...mutation, dailyRecalculated };
    }));
  }

  private async recalculateCalculatedDay(
    transaction: Kysely<Database>,
    metricDate: string,
    changed: boolean,
  ): Promise<boolean> {
    if (!changed) return false;
    const daily = await transaction.selectFrom('daily_metrics')
      .select('score_status')
      .where('metric_date', '=', metricDate)
      .forUpdate()
      .executeTakeFirst();
    if (daily?.score_status !== 'calculated') return false;
    await new DailyScoringRepository(transaction)
      .recalculateFromActivitiesInTransaction(metricDate, 'activity_distance_correction');
    return true;
  }
}
