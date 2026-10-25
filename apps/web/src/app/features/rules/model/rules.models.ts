export type ActivityType = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus';
export type RuleKind = 'coefficient' | 'achievement' | 'manual_points';
export type ThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists';
export type PointsMultiplier = 'completed_5k_blocks' | 'rounded_5k_blocks' | 'completed_1k_blocks' | 'completed_10k_blocks';

/** Descriptive application output; the browser never calculates scores. */
export interface RuleGuide {
  label: string;
  award: string;
  notes: string[];
  example?: string;
}

export interface RuleVersion {
  id: string;
  version: number;
  supersedesRuleId: string | null;
  code: string;
  name: string;
  activityType: ActivityType;
  activitySubtype?: 'outdoor' | 'indoor' | 'treadmill' | 'track' | 'manual' | 'race' | 'unknown';
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
  description?: string;
  enabled: boolean;
  createdAt: string;
  guide: RuleGuide;
}
