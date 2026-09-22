export const DYNAMICS_METRICS = ['score', 'steps', 'run', 'bike', 'swim', 'workout', 'bonus'] as const;
export type DynamicsMetric = typeof DYNAMICS_METRICS[number];
export type DynamicsGranularity = 'daily' | 'weekly' | 'monthly';
export type DynamicsMeasure = 'total' | 'recordedDayAverage';
export type RollingDynamicsMeasure = DynamicsMeasure | 'activeDays';
export const ROLLING_WINDOWS = [10, 20, 30, 60, 365] as const;
export type RollingWindow = typeof ROLLING_WINDOWS[number];
export const SCORE_CONTRIBUTION_CATEGORIES = ['steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'bonus'] as const;
export type ScoreContributionCategory = typeof SCORE_CONTRIBUTION_CATEGORIES[number];

export interface DynamicsMetricAggregate {
  total: number | null;
  recordedDayAverage: number | null;
}

export interface DynamicsBucket {
  key: string;
  from: string;
  to: string;
  calendarDays: number;
  recordedDays: number;
  partial: boolean;
  values: Partial<Record<DynamicsMetric, DynamicsMetricAggregate>>;
  scoreContributions?: Partial<Record<ScoreContributionCategory, number>>;
}

export interface DynamicsResponse {
  range: { from: string; to: string };
  granularity: DynamicsGranularity;
  metrics: DynamicsMetric[];
  metricUnits: Record<DynamicsMetric, 'points' | 'steps' | 'metres'>;
  monthly: DynamicsBucket[];
  series: DynamicsBucket[];
}

export interface RollingMetricValue {
  total: number | null;
  calendarDayAverage: number | null;
  activeDays: number | null;
  recordedDays: number;
  windowDays: number;
  complete: boolean;
}

export interface RollingDynamicsPoint {
  date: string;
  dailyValue: number | null;
  windows: Partial<Record<RollingWindow, RollingMetricValue>>;
}

export interface RollingDynamicsResponse {
  range: { from: string; to: string };
  metric: DynamicsMetric;
  unit: 'points' | 'steps' | 'metres';
  windows: RollingWindow[];
  points: RollingDynamicsPoint[];
  scoreContributions: Partial<Record<RollingWindow, {
    windowDays: RollingWindow;
    categories: ScoreContributionCategory[];
    points: Array<{
      date: string;
      contributions: Partial<Record<ScoreContributionCategory, number>>;
      total: number;
    }>;
  }>>;
}
