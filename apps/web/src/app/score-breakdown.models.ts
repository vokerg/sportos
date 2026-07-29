export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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
  batch: ImportBatchReference;
}

export type ActivityType = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'power_bonus';

export interface ScoreBreakdownActivity {
  id: string;
  source: 'manual' | 'my_sport_xlsx' | 'run_db_xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit';
  sourceActivityId: string | null;
  activityDate: string;
  startTime: string | null;
  activityType: ActivityType;
  subtype: 'outdoor' | 'indoor' | 'treadmill' | 'manual' | 'race' | 'unknown' | null;
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

export interface ScoreBreakdownLedgerEntry {
  id: string;
  points: number;
  reason: string;
  calculation: JsonValue;
  createdAt: string;
  rule: ScoreBreakdownRule | null;
  activity: ScoreBreakdownActivity | null;
}

export interface DailyScoreBreakdown {
  date: string;
  recomputedAt: string;
  facts: {
    steps: number;
    runM: number;
    bikeM: number;
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
  sourceRecord: SourceRecordReference | null;
  ledger: ScoreBreakdownLedgerEntry[];
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  date?: string;
}
