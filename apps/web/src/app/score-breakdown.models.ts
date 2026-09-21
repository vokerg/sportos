export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ScoreBreakdownViewState = 'idle' | 'loading' | 'loaded' | 'error';

export interface ImportBatchReference {
  id: string;
  source: string;
  filename: string | null;
  originalSha256: string | null;
  status: 'started' | 'parsed' | 'normalized' | 'scored' | 'failed';
  startedAt: string;
  completedAt: string | null;
}

export interface SourceRecordReference {
  id: string;
  rowHash: string;
  sheetName: string | null;
  rowIndex: number | null;
  status: 'raw' | 'normalized' | 'skipped' | 'error';
  rawJson: JsonValue;
  errors: JsonValue;
  warnings: JsonValue;
  normalizedEntityType: string | null;
  normalizedEntityId: string | null;
  batch: ImportBatchReference;
}

export type ActivityType = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus';

export interface DailyRunStepCalculation {
  activityId?: string;
  distanceM?: number;
  movingTimeS: number;
  paceSPerKm?: number;
  cadenceSpm: number;
  cadenceSource: 'strava_cadence' | 'pace_fallback';
  estimatedSteps: number;
}

export interface DailyStepsCalculation {
  source: 'manual' | 'manual_adjusted' | 'imported' | 'garmin_adjusted' | 'stored' | 'none';
  resolvedSteps: number;
  totalSteps?: number;
  garminTotalSteps?: number;
  estimatedRunningSteps?: number;
  runs?: DailyRunStepCalculation[];
  unestimatedRunCount?: number;
}

export interface ScoreBreakdownActivity {
  id: string;
  source: 'manual' | 'my_sport_xlsx' | 'run_db_xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit';
  sourceActivityId: string | null;
  activityDate: string;
  startTime: string | null;
  activityType: ActivityType;
  subtype: 'outdoor' | 'indoor' | 'treadmill' | 'track' | 'manual' | 'race' | 'unknown' | null;
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
  sourceRecord: SourceRecordReference | null;
}

export interface ScoreBreakdownRule {
  id: string;
  code: string;
  name: string;
  activityType: ActivityType;
  activitySubtype?: 'outdoor' | 'indoor' | 'treadmill' | 'track' | 'manual' | 'race' | 'unknown' | null;
  ruleKind: 'coefficient' | 'achievement' | 'manual_points';
  metric: string;
  coefficient: number | null;
  thresholdOperator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists' | null;
  thresholdValue: number | null;
  thresholdUnit: string | null;
  configuredPoints: number | null;
  achievementGroup: string | null;
  pointsMultiplier: 'completed_5k_blocks' | 'rounded_5k_blocks' | null;
  validFrom: string;
  validTo: string | null;
  priority: number;
  enabled: boolean;
  description: string | null;
  createdAt: string;
}

export interface ScoreBreakdownLedgerEntry {
  id: string;
  points: number;
  reason: string;
  calculation: JsonValue;
  createdAt: string;
  rule: ScoreBreakdownRule | null;
  activity: ScoreBreakdownActivity | null;
}

export type GarminReportType =
  | 'daily_summary'
  | 'steps_weekly'
  | 'calories_weekly'
  | 'floors_weekly'
  | 'weight_body_composition';

export interface GarminObservation {
  id: string;
  reportType: GarminReportType;
  recordedDate: string;
  recordedTime: string | null;
  values: JsonValue;
  sourceRecord: SourceRecordReference;
}

export interface DailyEvidence {
  date: string;
  garminObservations: GarminObservation[];
  sourceRecords: SourceRecordReference[];
}

export interface DailyScoreBreakdown {
  date: string;
  recomputedAt: string;
  scoreStatus: 'imported' | 'calculated' | 'manual';
  facts: {
    steps: number;
    stepsCalculation?: DailyStepsCalculation;
    runM: number;
    runIndoorM?: number | null;
    runOutdoorM?: number | null;
    runUnspecifiedM?: number | null;
    bikeM: number;
    bikeIndoorM?: number | null;
    bikeOutdoorM?: number | null;
    bikeUnspecifiedM?: number | null;
    swimM: number;
    workoutPoints: number;
  };
  score: {
    appTotal: number;
    excelTotal: number | null;
    delta: number | null;
    baseTotal: number;
    bonusPoints: number;
    ledgerTotal: number;
  };
  sourceRecord: SourceRecordReference | null;
  activities: ScoreBreakdownActivity[];
  garminObservations: GarminObservation[];
  sourceRecords: SourceRecordReference[];
  ledger: ScoreBreakdownLedgerEntry[];
}

export interface ManualDailyFactsInput {
  steps: number;
  totalSteps?: number;
  runIndoorM: number;
  runOutdoorM: number;
  runUnspecifiedM?: number;
  bikeIndoorM: number;
  bikeOutdoorM: number;
  bikeUnspecifiedM?: number;
  swimM: number;
  workoutPoints: number;
  bonusPoints: number;
}

export interface ManualDailyFactsRow {
  date: string;
  scoreStatus: DailyScoreBreakdown['scoreStatus'];
  totalPoints: number;
  facts: ManualDailyFactsInput;
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  date?: string;
}
