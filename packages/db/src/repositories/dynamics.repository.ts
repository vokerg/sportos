import type { Kysely } from 'kysely';
import type { ActivitiesTable, Database, Json } from '../schema.js';

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

export interface ScoreContributionRow {
  metricDate: string;
  activityType: ActivitiesTable['activity_type'];
  points: number;
}

const IMPORTED_SCORE_COLUMNS: Record<string, ActivitiesTable['activity_type']> = {
  steps: 'steps',
  run_to_s: 'run',
  bike_to_s: 'bike',
  sup_to_s: 'sup',
  raw_to_s: 'rowing',
  swim_to_s: 'swim',
  wototal: 'workout',
  pow: 'bonus',
};

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

  async listScoreContributions(from: string, to: string): Promise<ScoreContributionRow[]> {
    const rows = await this.db
      .selectFrom('score_ledger as sl')
      .leftJoin('scoring_rules as sr', 'sr.id', 'sl.rule_id')
      .leftJoin('activities as a', 'a.id', 'sl.activity_id')
      .innerJoin('daily_metrics as dm', (join) => join
        .onRef('dm.owner_id', '=', 'sl.owner_id')
        .onRef('dm.metric_date', '=', 'sl.metric_date'))
      .leftJoin('source_records as src', (join) => join
        .onRef('src.owner_id', '=', 'dm.owner_id')
        .onRef('src.id', '=', 'dm.source_record_id'))
      .select([
        'sl.metric_date as metricDate',
        'sl.points',
        'sr.activity_type as ruleActivityType',
        'sr.rule_kind as ruleKind',
        'a.activity_type as activityType',
        'src.raw_json as sourceRaw',
      ])
      .where('sl.metric_date', '>=', from)
      .where('sl.metric_date', '<=', to)
      .orderBy('sl.metric_date', 'asc')
      .execute();

    const totals = new Map<string, ScoreContributionRow>();
    for (const row of rows) {
      const metricDate = isoDate(row.metricDate);
      const activityType = scoreContributionActivityType(row.ruleKind, row.ruleActivityType, row.activityType);
      const points = numeric(row.points);
      const contributions = activityType
        ? [{ metricDate, activityType, points }]
        : importedScoreContributionRows(metricDate, points, row.sourceRaw);
      for (const contribution of contributions) {
        const key = `${metricDate}:${contribution.activityType}`;
        const existing = totals.get(key);
        if (existing) existing.points += contribution.points;
        else totals.set(key, contribution);
      }
    }
    return [...totals.values()];
  }
}

export function scoreContributionActivityType(
  ruleKind: 'coefficient' | 'achievement' | 'manual_points' | null,
  ruleActivityType: ActivitiesTable['activity_type'] | null,
  activityType: ActivitiesTable['activity_type'] | null,
): ActivitiesTable['activity_type'] | null {
  return ruleKind === 'achievement' ? 'bonus' : ruleActivityType ?? activityType;
}

export function importedScoreContributionRows(metricDate: string, ledgerPoints: number, sourceRaw: Json | null): ScoreContributionRow[] {
  if (!sourceRaw || typeof sourceRaw !== 'object' || Array.isArray(sourceRaw)) {
    throw new TypeError(`Imported score ledger for ${metricDate} has no retained workbook row.`);
  }
  const headers = sourceRaw.headers;
  const cells = sourceRaw.cells;
  if (!Array.isArray(headers) || !Array.isArray(cells)) {
    throw new TypeError(`Imported score ledger for ${metricDate} has no retained workbook cells.`);
  }

  const totals = new Map<ActivitiesTable['activity_type'], number>();
  headers.forEach((header, index) => {
    const activityType = IMPORTED_SCORE_COLUMNS[workbookKey(header)];
    if (!activityType) return;
    const points = sourceNumber(cells[index]);
    if (points === null) return;
    totals.set(activityType, (totals.get(activityType) ?? 0) + points);
  });
  const componentTotal = [...totals.values()].reduce((sum, points) => sum + points, 0);
  if (Math.abs(componentTotal - ledgerPoints) > 1e-6) {
    throw new TypeError(`Imported score components for ${metricDate} do not match the official ledger total.`);
  }
  return [...totals.entries()]
    .filter(([, points]) => points !== 0)
    .map(([activityType, points]) => ({ metricDate, activityType, points }));
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

function workbookKey(value: Json | undefined): string {
  if (value === null || value === undefined || typeof value === 'object') return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function sourceNumber(value: Json | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return value.trim() && Number.isFinite(parsed) ? parsed : null;
}
