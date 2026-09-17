import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';

export interface DynamicsDailyRow {
  metricDate: string;
  score: number;
  steps: number;
  run: number;
  bike: number;
  swim: number;
  workout: number;
  bonus: number;
}

export class DynamicsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listDailyRows(from: string, to: string): Promise<DynamicsDailyRow[]> {
    const rows = await this.db
      .selectFrom('daily_metrics')
      .select([
        'metric_date as metricDate',
        'total_points as score',
        'steps',
        'run_m as run',
        'bike_m as bike',
        'swim_m as swim',
        'workout_points as workout',
        'bonus_points as bonus',
      ])
      .where('metric_date', '>=', from)
      .where('metric_date', '<=', to)
      .orderBy('metric_date', 'asc')
      .execute();

    return rows.map((row) => ({
      metricDate: isoDate(row.metricDate),
      score: numeric(row.score),
      steps: numeric(row.steps),
      run: numeric(row.run),
      bike: numeric(row.bike),
      swim: numeric(row.swim),
      workout: numeric(row.workout),
      bonus: numeric(row.bonus),
    }));
  }
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  throw new TypeError('Expected a database date value.');
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Expected a finite dynamics metric value.');
  return parsed;
}
