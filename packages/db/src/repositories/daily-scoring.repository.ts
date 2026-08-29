import { aggregateActivitiesToDailyFacts, scoreDay, type ActivityFact } from '@sportos/domain';
import { sql, type Kysely } from 'kysely';
import type { Activity, DailyMetric, Database } from '../schema.js';
import type { DailyMetricFactsInput } from '../repository-contracts.js';
import { DailyRepository } from './daily.repository.js';
import { ScoringRepository } from './scoring.repository.js';

export class DailyRecalculationUnavailableError extends Error {
  readonly code = 'STRAVA_DATA_UNAVAILABLE' as const;

  constructor(readonly metricDate: string) {
    super(`No Strava activity is available for ${metricDate}.`);
    this.name = 'DailyRecalculationUnavailableError';
  }
}

export class DailyScoringRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async recalculateFromActivities(metricDate: string) {
    return this.db.transaction().execute(async (transaction) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(
            'sportos.daily.recalculate:' || sportos_current_account_id()::text || ':' || ${metricDate},
            0
          )
        )
      `.execute(transaction);

      const daily = await transaction
        .selectFrom('daily_metrics')
        .selectAll()
        .where('metric_date', '=', metricDate)
        .forUpdate()
        .executeTakeFirst();
      const dailyRepository = new DailyRepository(transaction);
      const activityRows = await dailyRepository.listActivitiesForDates([metricDate]);
      const activities = activityRows.map(toActivityFact);
      const stravaActivities = activities.filter((activity) => activity.source === 'strava');

      if (!daily && stravaActivities.length === 0) {
        throw new DailyRecalculationUnavailableError(metricDate);
      }

      const scoringActivities = daily ? activities : stravaActivities;
      const facts = daily
        ? factsFromDailyRow(daily, scoringActivities)
        : aggregateActivitiesToDailyFacts(metricDate, stravaActivities);
      const score = scoreDay(
        { ...facts, excelAllPoints: undefined, excelRowHash: undefined },
        scoringActivities,
        await new ScoringRepository(transaction).listEnabledRules(),
      );

      await dailyRepository.persistDailyScore(
        facts,
        score,
        daily?.source_record_id ?? undefined,
        { scoreStatus: 'calculated', trigger: 'manual_recalculation' },
      );

      const result = await dailyRepository.getDailyScoreBreakdown(metricDate);
      if (!result) throw new Error(`Daily score disappeared while recalculating ${metricDate}.`);
      return result;
    });
  }
}

function factsFromDailyRow(row: DailyMetric, activities: ActivityFact[]): DailyMetricFactsInput {
  const stored = {
    metricDate: dateString(row.metric_date),
    steps: number(row.steps),
    runM: number(row.run_m),
    bikeM: number(row.bike_m),
    swimM: number(row.swim_m),
    workoutPoints: number(row.workout_points),
    powerPoints: number(row.power_points),
    excelAllPoints: optionalNumber(row.excel_all_points),
    excelRowHash: row.excel_row_hash ?? undefined,
  };

  if (activities.length === 0) return stored;

  const aggregated = aggregateActivitiesToDailyFacts(
    stored.metricDate,
    activities,
    stored.excelAllPoints,
  );
  return {
    ...aggregated,
    excelRowHash: stored.excelRowHash,
  };
}

function toActivityFact(row: Activity): ActivityFact {
  return {
    id: row.id,
    activityDate: dateString(row.activity_date),
    activityType: row.activity_type,
    subtype: row.subtype ?? undefined,
    distanceM: optionalNumber(row.distance_m),
    durationS: optionalNumber(row.duration_s),
    steps: optionalNumber(row.steps),
    avgSpeedMps: optionalNumber(row.avg_speed_mps),
    effortPoints: optionalNumber(row.effort_points),
    source: row.source,
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return number(value);
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Invalid numeric daily score input.');
  return parsed;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new Error('Invalid daily score date.');
}
