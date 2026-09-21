export type ActivityType = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus';
export type RuleKind = 'coefficient' | 'achievement' | 'manual_points';
export type ThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists';
export type PointsMultiplier = 'completed_5k_blocks' | 'rounded_5k_blocks';
export type RuleChangeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RuleProposal {
  replaceRuleId?: string;
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
}

export interface RuleVersion extends Omit<RuleProposal, 'replaceRuleId'> {
  id: string;
  version: number;
  supersedesRuleId: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface RulePreviewRow {
  metricDate: string;
  currentBasePoints: number;
  proposedBasePoints: number;
  currentBonusPoints: number;
  proposedBonusPoints: number;
  currentTotalPoints: number;
  proposedTotalPoints: number;
  delta: number;
}

export interface RulePreviewResponse {
  proposal: RuleProposal;
  preview: {
    affectedFrom: string;
    affectedTo: string;
    totalDates: number;
    changedDates: number;
    aggregateDelta: number;
    minimumDelta: number;
    maximumDelta: number;
    rows: RulePreviewRow[];
  };
  previewFingerprint: string;
}

export interface RuleChange {
  id: string;
  ruleCode: string;
  previousRuleId: string | null;
  proposedRuleId: string;
  status: RuleChangeStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  initiatedBy: string;
  reason: string;
  proposal: RuleProposal;
  preview: RulePreviewResponse['preview'];
  previewFingerprint: string;
  affectedFrom: string;
  affectedTo: string;
  error: { code: string; message: string } | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
