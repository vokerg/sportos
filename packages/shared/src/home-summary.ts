/** Read-only presentation aggregates. Missing calendar days are never invented as zero. */
export interface HomeDay {
  metric_date: string;
  total_points: number;
  steps: number;
  run_m: number;
  bike_m: number;
  swim_m: number;
  workout_points: number;
  bonus_points: number;
}
export function homeAverages(days: readonly HomeDay[], from: string, to: string) {
  const rows = days.filter(day => day.metric_date >= from && day.metric_date <= to);
  const average = (key: keyof Omit<HomeDay, 'metric_date'>) => {
    if (!rows.length) return null;
    let total = 0;
    for (const row of rows) {
      // PostgreSQL decimal JSON can contain strings despite the client transport type.
      const raw: unknown = row[key];
      const value = typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      total += value;
    }
    return Number.isFinite(total) ? total / rows.length : null;
  };
  return { count: rows.length, score: average('total_points'), steps: average('steps'),
    run: average('run_m'), bike: average('bike_m'), swim: average('swim_m'),
    workout: average('workout_points'), bonus: average('bonus_points') };
}
