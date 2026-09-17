export type ActivityType =
  | 'steps'
  | 'run'
  | 'bike'
  | 'swim'
  | 'workout'
  | 'rowing'
  | 'sup'
  | 'hiit'
  | 'bonus';

export type ActivitySubtype = 'outdoor' | 'indoor' | 'treadmill' | 'manual' | 'race' | 'unknown';

export type DailyScoreStatus = 'imported' | 'calculated' | 'manual';

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
  runUnspecifiedM?: number;
  bikeM: number;
  bikeIndoorM?: number;
  bikeOutdoorM?: number;
  bikeUnspecifiedM?: number;
  swimM: number;
  workoutPoints: number;
  bonusPoints: number;
  excelAllPoints?: number;
  excelRowHash?: string;
}

export interface ImportedLedgerFormulaInput {
  sourceColumn: string;
  cellReference: string;
  value: number;
}

export interface ImportedLedgerEvidence {
  allFormula?: string;
  formulaInputs?: ImportedLedgerFormulaInput[];
  formulaIsAdditive?: boolean;
}

export type RuleKind = 'coefficient' | 'achievement' | 'manual_points';
export type ThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists';
export type PointsMultiplier = 'completed_5k_blocks' | 'rounded_5k_blocks';

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
  achievementGroup?: string;
  pointsMultiplier?: PointsMultiplier;
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
