export interface DateRangeQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export type DailyScoreContributionCategory =
  | 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus' | 'unattributed';

export interface DailySummaryRow {
  providerSources?: { strava: boolean; garmin: boolean };
  score_contributions?: Partial<Record<DailyScoreContributionCategory, number>>;
  metric_date: string;
  steps: number;
  run_m: number;
  bike_m: number;
  swim_m: number;
  workout_points: number;
  base_points: number;
  bonus_points: number;
  total_points: number;
  excel_all_points: number | null;
  points_delta_vs_excel: number | null;
  avg_10d: number | null;
  avg_20d: number | null;
  avg_30d: number | null;
  avg_60d: number | null;
  avg_365d: number | null;
  score_status: 'imported' | 'calculated' | 'manual';
}
