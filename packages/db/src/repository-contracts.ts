import type { ActivitiesTable, Json } from './schema.js';

export interface DailyMetricFactsInput {
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
  activitySubtype?: Exclude<ActivitiesTable['subtype'], null>;
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

export interface ImportBatchReferenceReadModel {
  id: string;
  source: string;
  filename: string | null;
  originalSha256: string | null;
  status: 'started' | 'parsed' | 'normalized' | 'scored' | 'failed';
  startedAt: string;
  completedAt: string | null;
}

export interface SourceRecordReferenceReadModel {
  id: string;
  rowHash: string;
  sheetName: string | null;
  rowIndex: number | null;
  status: 'raw' | 'normalized' | 'skipped' | 'error';
  rawJson: Json;
  errors: Json;
  warnings: Json;
  normalizedEntityType: string | null;
  normalizedEntityId: string | null;
  batch: ImportBatchReferenceReadModel;
}

export interface ScoreBreakdownActivityReadModel {
  id: string;
  source: ActivitiesTable['source'];
  sourceActivityId: string | null;
  activityDate: string;
  startTime: string | null;
  activityType: ActivitiesTable['activity_type'];
  subtype: ActivitiesTable['subtype'];
  distanceM: number | null;
  durationS: number | null;
  movingTimeS: number | null;
  steps: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  avgSpeedMps: number | null;
  avgPaceSPerKm: number | null;
  effortPoints: number | null;
  notes: string | null;
  sourceRecord: SourceRecordReferenceReadModel | null;
}

export interface ScoreBreakdownRuleReadModel {
  id: string;
  code: string;
  name: string;
  activityType: ActivitiesTable['activity_type'];
  activitySubtype?: ActivitiesTable['subtype'];
  ruleKind: 'coefficient' | 'achievement' | 'manual_points';
  metric: string;
  coefficient: number | null;
  thresholdOperator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists' | null;
  thresholdValue: number | null;
  thresholdUnit: string | null;
  configuredPoints: number | null;
  validFrom: string;
  validTo: string | null;
  priority: number;
  enabled: boolean;
  description: string | null;
  createdAt: string;
}

export interface ScoreBreakdownLedgerEntryReadModel {
  id: string;
  points: number;
  reason: string;
  calculation: Json;
  createdAt: string;
  rule: ScoreBreakdownRuleReadModel | null;
  activity: ScoreBreakdownActivityReadModel | null;
}

export interface DailyScoreBreakdownReadModel {
  date: string;
  recomputedAt: string;
  facts: {
    steps: number;
    runM: number;
    runIndoorM?: number | null;
    runOutdoorM?: number | null;
    bikeM: number;
    bikeIndoorM?: number | null;
    bikeOutdoorM?: number | null;
    swimM: number;
    workoutPoints: number;
    powerPoints: number;
  };
  score: {
    appTotal: number;
    excelTotal: number | null;
    delta: number | null;
    baseTotal: number;
    bonusTotal: number;
    ledgerTotal: number;
  };
  sourceRecord: SourceRecordReferenceReadModel | null;
  activities: ScoreBreakdownActivityReadModel[];
  sourceRecords: SourceRecordReferenceReadModel[];
  ledger: ScoreBreakdownLedgerEntryReadModel[];
}
