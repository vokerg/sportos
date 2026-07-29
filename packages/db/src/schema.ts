import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type DateString = ColumnType<string, string, string>;

export interface ImportBatchesTable {
  id: Generated<string>;
  source: string;
  source_kind: 'xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit' | 'manual';
  filename: string | null;
  original_sha256: string | null;
  status: 'started' | 'parsed' | 'normalized' | 'scored' | 'failed';
  row_count: number;
  normalized_count: number;
  error_count: number;
  warning_count: number;
  started_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
  metadata: Json;
}

export interface SourceRecordsTable {
  id: Generated<string>;
  import_batch_id: string;
  source: string;
  sheet_name: string | null;
  row_index: number | null;
  source_record_key: string | null;
  row_hash: string;
  raw_json: Json;
  normalized_entity_type: string | null;
  normalized_entity_id: string | null;
  status: 'raw' | 'normalized' | 'skipped' | 'error';
  errors: Json;
  warnings: Json;
  created_at: Generated<Timestamp>;
}

export interface ActivitiesTable {
  id: Generated<string>;
  source: 'manual' | 'my_sport_xlsx' | 'run_db_xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit';
  source_record_id: string | null;
  source_activity_id: string | null;
  source_record_hash: string | null;
  activity_date: DateString;
  start_time: Timestamp | null;
  activity_type: 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'power_bonus';
  subtype: 'outdoor' | 'indoor' | 'treadmill' | 'manual' | 'race' | 'unknown' | null;
  distance_m: number | null;
  duration_s: number | null;
  moving_time_s: number | null;
  steps: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  elevation_gain_m: number | null;
  avg_speed_mps: number | null;
  avg_pace_s_per_km: number | null;
  effort_points: number | null;
  notes: string | null;
  raw_payload_json: Json;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface DailyMetricsTable {
  metric_date: DateString;
  source_record_id: string | null;
  steps: number;
  run_m: number;
  bike_m: number;
  swim_m: number;
  workout_points: number;
  power_points: number;
  base_points: number;
  bonus_points: number;
  total_points: number;
  excel_all_points: number | null;
  excel_row_hash: string | null;
  recomputed_at: Generated<Timestamp>;
}

export interface ScoringRulesTable {
  id: Generated<string>;
  code: string;
  name: string;
  activity_type: ActivitiesTable['activity_type'];
  rule_kind: 'coefficient' | 'achievement' | 'manual_points';
  metric: string;
  coefficient: number | null;
  threshold_operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists' | null;
  threshold_value: number | null;
  threshold_unit: string | null;
  points: number | null;
  valid_from: DateString;
  valid_to: DateString | null;
  priority: number;
  enabled: boolean;
  description: string | null;
  created_at: Generated<Timestamp>;
}

export interface ScoreLedgerTable {
  id: Generated<string>;
  metric_date: DateString;
  activity_id: string | null;
  rule_id: string | null;
  points: number;
  reason: string;
  calculation_json: Json;
  created_at: Generated<Timestamp>;
}

export interface PerformanceEventsTable {
  id: Generated<string>;
  activity_id: string | null;
  source_record_id: string | null;
  source_record_hash: string | null;
  source: 'manual' | 'run_db_xlsx' | 'strava' | 'garmin' | 'fit';
  event_date: DateString;
  distance_m: number;
  duration_s: number;
  pace_s_per_km: number;
  is_treadmill: boolean;
  is_race: boolean;
  is_pr_marker: boolean;
  source_rank: number | null;
  tags: string[];
  notes: string | null;
  raw_payload_json: Json;
  created_at: Generated<Timestamp>;
}

export interface Database {
  import_batches: ImportBatchesTable;
  source_records: SourceRecordsTable;
  activities: ActivitiesTable;
  daily_metrics: DailyMetricsTable;
  scoring_rules: ScoringRulesTable;
  score_ledger: ScoreLedgerTable;
  performance_events: PerformanceEventsTable;
  v_daily_summary: DailyMetricsTable & { points_delta_vs_excel: number | null; avg_10d: number | null; avg_20d: number | null; avg_30d: number | null; avg_60d: number | null; avg_365d: number | null };
  v_performance_events: PerformanceEventsTable & { all_time_rank: number; is_pr_by_time: boolean };
}

export type ImportBatch = Selectable<ImportBatchesTable>;
export type NewImportBatch = Insertable<ImportBatchesTable>;
export type SourceRecord = Selectable<SourceRecordsTable>;
export type NewSourceRecord = Insertable<SourceRecordsTable>;
export type Activity = Selectable<ActivitiesTable>;
export type NewActivity = Insertable<ActivitiesTable>;
export type DailyMetric = Selectable<DailyMetricsTable>;
export type NewDailyMetric = Insertable<DailyMetricsTable>;
export type ScoringRuleRow = Selectable<ScoringRulesTable>;
export type NewScoreLedger = Insertable<ScoreLedgerTable>;
export type PerformanceEvent = Selectable<PerformanceEventsTable>;
export type NewPerformanceEvent = Insertable<PerformanceEventsTable>;
