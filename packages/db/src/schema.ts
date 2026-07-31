import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
export type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
export type DateString = ColumnType<string, string, string>;

export interface UploadedFilesTable {
  id: string;
  workbook_kind: 'my_sport' | 'run_db';
  storage_provider: 'local';
  object_key: string;
  original_filename: string;
  sanitized_filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  status: 'stored' | 'imported' | 'failed' | 'deleted';
  last_error: string | null;
  created_at: Generated<Timestamp>;
  imported_at: Timestamp | null;
  deleted_at: Timestamp | null;
}

export interface ImportBatchesTable {
  id: Generated<string>;
  uploaded_file_id: Generated<string | null>;
  source: string;
  source_kind: 'xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit' | 'manual';
  filename: string | null;
  original_sha256: string | null;
  status: 'started' | 'parsed' | 'normalized' | 'scored' | 'failed';
  row_count: Generated<number>;
  normalized_count: Generated<number>;
  error_count: Generated<number>;
  warning_count: Generated<number>;
  started_at: Generated<Timestamp>;
  completed_at: Timestamp | null;
  metadata: Json;
}

export interface ImportJobsTable {
  id: Generated<string>;
  uploaded_file_id: string;
  import_batch_id: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  phase: string;
  progress_percent: number;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: NullableTimestamp;
  heartbeat_at: NullableTimestamp;
  cancellation_requested_at: NullableTimestamp;
  next_attempt_at: Timestamp;
  error_code: string | null;
  error_message: string | null;
  result_json: Json;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  started_at: NullableTimestamp;
  completed_at: NullableTimestamp;
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
  version: number;
  supersedes_rule_id: string | null;
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

export interface ScoringRuleChangesTable {
  id: Generated<string>;
  rule_code: string;
  previous_rule_id: string | null;
  proposed_rule_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  phase: string;
  progress_percent: number;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: NullableTimestamp;
  heartbeat_at: NullableTimestamp;
  cancellation_requested_at: NullableTimestamp;
  next_attempt_at: Timestamp;
  initiated_by: string;
  reason: string;
  proposal_json: Json;
  preview_json: Json;
  preview_fingerprint: string;
  affected_from: DateString;
  affected_to: DateString;
  error_code: string | null;
  error_message: string | null;
  result_json: Json;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  started_at: NullableTimestamp;
  completed_at: NullableTimestamp;
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
  uploaded_files: UploadedFilesTable;
  import_batches: ImportBatchesTable;
  import_jobs: ImportJobsTable;
  source_records: SourceRecordsTable;
  activities: ActivitiesTable;
  daily_metrics: DailyMetricsTable;
  scoring_rules: ScoringRulesTable;
  scoring_rule_changes: ScoringRuleChangesTable;
  score_ledger: ScoreLedgerTable;
  performance_events: PerformanceEventsTable;
  v_daily_summary: Omit<DailyMetricsTable, 'source_record_id'> & { points_delta_vs_excel: number | null; avg_10d: number | null; avg_20d: number | null; avg_30d: number | null; avg_60d: number | null; avg_365d: number | null };
  v_performance_events: Omit<PerformanceEventsTable, 'source_record_hash'> & { all_time_rank: number; is_pr_by_time: boolean };
}

export type UploadedFile = Selectable<UploadedFilesTable>;
export type NewUploadedFile = Insertable<UploadedFilesTable>;
export type ImportBatch = Selectable<ImportBatchesTable>;
export type NewImportBatch = Insertable<ImportBatchesTable>;
export type ImportJob = Selectable<ImportJobsTable>;
export type NewImportJob = Insertable<ImportJobsTable>;
export type SourceRecord = Selectable<SourceRecordsTable>;
export type NewSourceRecord = Insertable<SourceRecordsTable>;
export type Activity = Selectable<ActivitiesTable>;
export type NewActivity = Insertable<ActivitiesTable>;
export type DailyMetric = Selectable<DailyMetricsTable>;
export type NewDailyMetric = Insertable<DailyMetricsTable>;
export type ScoringRuleRow = Selectable<ScoringRulesTable>;
export type NewScoringRule = Insertable<ScoringRulesTable>;
export type ScoringRuleChange = Selectable<ScoringRuleChangesTable>;
export type NewScoreLedger = Insertable<ScoreLedgerTable>;
export type PerformanceEvent = Selectable<PerformanceEventsTable>;
export type NewPerformanceEvent = Insertable<PerformanceEventsTable>;
