import type { ActivitiesTable } from './schema.js';

export interface DailyMetricFactsInput {
  metricDate: string;
  steps: number;
  runM: number;
  bikeM: number;
  swimM: number;
  workoutPoints: number;
  powerPoints: number;
  excelAllPoints?: number;
  excelRowHash?: string;
}

export interface ScoreLedgerInput {
  metricDate: string;
  activityId?: string;
  ruleId?: string;
  points: number;
  reason: string;
  calculationJson: Record<string, unknown>;
}

export interface DailyScoreInput {
  metricDate: string;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  ledger: ScoreLedgerInput[];
}

export interface EnabledScoringRule {
  id?: string;
  code: string;
  name: string;
  activityType: ActivitiesTable['activity_type'];
  ruleKind: 'coefficient' | 'achievement' | 'manual_points';
  metric: string;
  coefficient?: number;
  thresholdOperator?: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists';
  thresholdValue?: number;
  thresholdUnit?: string;
  points?: number;
  validFrom: string;
  validTo?: string;
  priority: number;
  enabled: boolean;
  description?: string;
}
