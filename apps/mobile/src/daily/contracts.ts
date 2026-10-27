/** Narrow, read-only projections of the existing Daily and Activities API JSON contracts. */
export type ScoreAuthority = 'imported' | 'manual' | 'calculated';
export type ContributionCategory = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus' | 'unattributed';
export interface DailySummary {
  metric_date: string;
  score_status: ScoreAuthority;
  total_points: number;
  base_points: number;
  bonus_points: number;
  steps: number;
  run_m: number;
  bike_m: number;
  swim_m: number;
  workout_points: number;
  excel_all_points: number | null;
  points_delta_vs_excel: number | null;
  avg_30d: number | null;
  score_contributions?: Partial<Record<ContributionCategory, number>>;
  providerSources?: { strava: boolean; garmin: boolean };
}
export interface DailyBreakdown {
  date: string;
  recomputedAt: string;
  scoreStatus: ScoreAuthority;
  score: {
    appTotal: number;
    baseTotal: number;
    bonusPoints: number;
    ledgerTotal: number;
    excelTotal: number | null;
    delta: number | null;
  };
  facts: {
    steps: number;
    runM: number;
    bikeM: number;
    swimM: number;
    workoutPoints: number;
    stepsCalculation?: { source: string; resolvedSteps: number; totalSteps?: number; garminSource?: string };
    workoutCalculation?: { source: string; resolvedPoints: number; workingSets?: number };
  };
  ledger: Array<{
    id: string;
    points: number;
    reason: string;
    rule: { name: string; activityType: string } | null;
    activity: { id: string; activityType: string } | null;
  }>;
  activities: Array<{ id: string; source: string; activityType: string; distanceM: number | null }>;
  // Backend also returns raw provenance objects. Never store, render or log those fields.
}
export interface ActivityPreview {
  id: string;
  activity_date: string;
  activity_type: string;
  source: string;
  distance_m: number | null;
  duration_s: number | null;
}
export interface ActivityListPreview {
  items: ActivityPreview[];
  summary: { count: number };
}

/** No backend raw import metadata, source records or provider details are retained here. */
export interface MobileDayDetail {
  date: string;
  recomputedAt: string;
  status: ScoreAuthority;
  score: DailyBreakdown['score'];
  facts: DailyBreakdown['facts'];
  ledger: Array<{ id: string; name: string; type: string | null; points: number }>;
  activityCount: number;
  sourceTypes: string[];
}
