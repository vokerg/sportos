import type { Kysely } from 'kysely';
import type { DailyMetricFacts, DailyScoreResult } from '@sportos/domain';
import type { Database, NewActivity } from '../schema.js';

export class DailyRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async upsertActivities(rows: NewActivity[]) {
    if (rows.length === 0) return [];
    return this.db.insertInto('activities').values(rows).returningAll().execute();
  }

  async upsertDailyMetric(facts: DailyMetricFacts, score: DailyScoreResult): Promise<void> {
    await this.db
      .insertInto('daily_metrics')
      .values({
        metric_date: facts.metricDate,
        steps: facts.steps,
        run_m: facts.runM,
        bike_m: facts.bikeM,
        swim_m: facts.swimM,
        workout_points: facts.workoutPoints,
        power_points: facts.powerPoints,
        base_points: score.basePoints,
        bonus_points: score.bonusPoints,
        total_points: score.totalPoints,
        excel_all_points: facts.excelAllPoints ?? null,
        excel_row_hash: facts.excelRowHash ?? null,
      })
      .onConflict((oc) =>
        oc.column('metric_date').doUpdateSet({
          steps: facts.steps,
          run_m: facts.runM,
          bike_m: facts.bikeM,
          swim_m: facts.swimM,
          workout_points: facts.workoutPoints,
          power_points: facts.powerPoints,
          base_points: score.basePoints,
          bonus_points: score.bonusPoints,
          total_points: score.totalPoints,
          excel_all_points: facts.excelAllPoints ?? null,
          excel_row_hash: facts.excelRowHash ?? null,
          recomputed_at: new Date(),
        }),
      )
      .execute();
  }

  async replaceScoreLedger(metricDate: string, entries: DailyScoreResult['ledger']): Promise<void> {
    await this.db.deleteFrom('score_ledger').where('metric_date', '=', metricDate).execute();
    if (entries.length === 0) return;
    await this.db
      .insertInto('score_ledger')
      .values(entries.map((entry) => ({
        metric_date: entry.metricDate,
        activity_id: entry.activityId ?? null,
        rule_id: entry.ruleId ?? null,
        points: entry.points,
        reason: entry.reason,
        calculation_json: entry.calculationJson,
      })))
      .execute();
  }

  async listDailySummary(limit = 90) {
    return this.db.selectFrom('v_daily_summary').selectAll().orderBy('metric_date', 'desc').limit(limit).execute();
  }
}
