import { sql, type Kysely } from 'kysely';
import type { DailyMetricFactsInput, DailyScoreInput } from '../repository-contracts.js';
import type { Activity, Database, Json, NewActivity } from '../schema.js';

export class DailyRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async upsertActivities(rows: NewActivity[]): Promise<Activity[]> {
    if (rows.length === 0) return [];
    const upserted: Activity[] = [];
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      upserted.push(
        ...(await this.db
          .insertInto('activities')
          .values(chunk)
          .onConflict((oc) =>
            oc.columns(['source', 'source_record_hash']).doUpdateSet({
              source_record_id: sql`excluded.source_record_id`,
              source_activity_id: sql`excluded.source_activity_id`,
              activity_date: sql`excluded.activity_date`,
              start_time: sql`excluded.start_time`,
              activity_type: sql`excluded.activity_type`,
              subtype: sql`excluded.subtype`,
              distance_m: sql`excluded.distance_m`,
              duration_s: sql`excluded.duration_s`,
              moving_time_s: sql`excluded.moving_time_s`,
              steps: sql`excluded.steps`,
              calories: sql`excluded.calories`,
              avg_hr: sql`excluded.avg_hr`,
              max_hr: sql`excluded.max_hr`,
              elevation_gain_m: sql`excluded.elevation_gain_m`,
              avg_speed_mps: sql`excluded.avg_speed_mps`,
              avg_pace_s_per_km: sql`excluded.avg_pace_s_per_km`,
              effort_points: sql`excluded.effort_points`,
              notes: sql`excluded.notes`,
              raw_payload_json: sql`excluded.raw_payload_json`,
              updated_at: new Date(),
            }),
          )
          .returningAll()
          .execute()),
      );
    }
    return upserted;
  }

  async listActivitiesForDates(metricDates: string[]): Promise<Activity[]> {
    if (metricDates.length === 0) return [];
    return this.db
      .selectFrom('activities')
      .selectAll()
      .where('activity_date', 'in', metricDates)
      .orderBy('activity_date', 'asc')
      .orderBy('id', 'asc')
      .execute();
  }

  async upsertDailyMetric(facts: DailyMetricFactsInput, score: DailyScoreInput, sourceRecordId?: string): Promise<void> {
    await this.db
      .insertInto('daily_metrics')
      .values({
        metric_date: facts.metricDate,
        source_record_id: sourceRecordId ?? null,
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
          source_record_id: sourceRecordId ?? null,
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

  async replaceScoreLedger(metricDate: string, entries: DailyScoreInput['ledger']): Promise<void> {
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
        calculation_json: entry.calculationJson as Json,
      })))
      .execute();
  }

  async listDailySummary(limit = 90) {
    return this.db
      .selectFrom('v_daily_summary')
      .selectAll()
      .where('metric_date', '<=', new Date().toISOString().slice(0, 10))
      .orderBy('metric_date', 'desc')
      .limit(limit)
      .execute();
  }
}
