export type ActivityType =
  | 'steps'
  | 'run'
  | 'bike'
  | 'swim'
  | 'workout'
  | 'rowing'
  | 'sup'
  | 'hiit'
  | 'power_bonus';

export type ActivitySubtype = 'outdoor' | 'indoor' | 'treadmill' | 'manual' | 'race' | 'unknown';

export type DailyScoreStatus = 'imported' | 'calculated';

export interface ActivityFact {
  id?: string;
  activityDate: string;
  activityType: ActivityType;
  subtype?: ActivitySubtype;
  distanceM?: number;
  durationS?: number;
  steps?: number;
  avgSpeedMps?: number;
  effortPoints?: number;
  source?: string;
  rawPayloadJson?: Record<string, unknown>;
}

export interface DailyMetricFacts {
  metricDate: string;
  steps: number;
  runM: number;
  runIndoorM?: number;
  runOutdoorM?: number;
  bikeM: number;
  bikeIndoorM?: number;
  bikeOutdoorM?: number;
  swimM: number;
  workoutPoints: number;
  powerPoints: number;
  excelAllPoints?: number;
  excelRowHash?: string;
}

export type RuleKind = 'coefficient' | 'achievement' | 'manual_points';
export type ThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists';

export interface ScoringRule {
  id?: string;
  code: string;
  name: string;
  activityType: ActivityType;
  activitySubtype?: ActivitySubtype;
  ruleKind: RuleKind;
  metric: string;
  coefficient?: number;
  thresholdOperator?: ThresholdOperator;
  thresholdValue?: number;
  thresholdUnit?: string;
  points?: number;
  validFrom: string;
  validTo?: string;
  priority: number;
  enabled: boolean;
  description?: string;
}

export interface ScoreLedgerEntry {
  metricDate: string;
  activityId?: string;
  ruleId?: string;
  ruleCode?: string;
  points: number;
  reason: string;
  calculationJson: Record<string, unknown>;
}

export interface DailyScoreResult {
  metricDate: string;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  ledger: ScoreLedgerEntry[];
}
