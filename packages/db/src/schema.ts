import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
export type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
export type DateString = ColumnType<string, string, string>;
export type OwnerId = Generated<string>;

export interface AccountsTable {
  id: Generated<string>;
  display_name: string;
  email: string | null;
  status: 'active' | 'disabled';
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ExternalIdentitiesTable {
  id: Generated<string>;
  account_id: string;
  issuer: string;
  subject: string;
  email: string | null;
  display_name: string | null;
  created_at: GeneratedTimestamp;
  last_login_at: GeneratedTimestamp;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  account_id: string;
  token_hash: string;
  csrf_hash: string;
  user_agent_hash: string | null;
  expires_at: Timestamp;
  absolute_expires_at: Timestamp;
  last_seen_at: GeneratedTimestamp;
  revoked_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
}

export interface AuthTransactionsTable {
  state_hash: string;
  code_verifier: string;
  nonce: string;
  return_to: string;
  expires_at: Timestamp;
  created_at: GeneratedTimestamp;
}

export interface UploadedFilesTable {
  id: string;
  owner_id: OwnerId;
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
  owner_id: OwnerId;
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
  owner_id: OwnerId;
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
  owner_id: OwnerId;
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
  owner_id: OwnerId;
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
  owner_id: OwnerId;
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
  recomputed_at: GeneratedTimestamp;
}

export interface ScoringRulesTable {
  id: Generated<string>;
  owner_id: OwnerId;
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
  owner_id: OwnerId;
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
  owner_id: OwnerId;
  metric_date: DateString;
  activity_id: string | null;
  rule_id: string | null;
  points: number;
  reason: string;
  calculation_json: Json;
  created_at: GeneratedTimestamp;
}

export interface PerformanceEventsTable {
  id: Generated<string>;
  owner_id: OwnerId;
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

export interface ProviderConnectionsTable {
  id: Generated<string>;
  owner_id: OwnerId;
  provider: 'strava';
  provider_account_id: string;
  display_name: string | null;
  scopes: string[];
  status: 'connected' | 'reauthorization_required' | 'revoked' | 'disconnected' | 'error';
  access_expires_at: NullableTimestamp;
  cursor_json: Json;
  last_sync_at: NullableTimestamp;
  last_attempt_at: NullableTimestamp;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  disconnected_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
}

export interface ProviderCredentialsTable {
  connection_id: string;
  owner_id: OwnerId;
  key_id: string;
  algorithm: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
  authentication_tag: string;
  envelope_version: 1;
  created_at: GeneratedTimestamp;
  rotated_at: GeneratedTimestamp;
}

export interface ProviderOauthTransactionsTable {
  state_hash: string;
  owner_id: OwnerId;
  provider: 'strava';
  return_to: string;
  expires_at: Timestamp;
  created_at: GeneratedTimestamp;
}

export interface ProviderSyncJobsTable {
  id: Generated<string>;
  owner_id: OwnerId;
  connection_id: string;
  import_batch_id: string | null;
  mode: 'initial_backfill' | 'incremental' | 'webhook_refresh';
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
  requested_after: NullableTimestamp;
  requested_before: NullableTimestamp;
  cursor_json: Json;
  error_code: string | null;
  error_message: string | null;
  result_json: Json;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
  started_at: NullableTimestamp;
  completed_at: NullableTimestamp;
}

export interface ProviderActivityLinksTable {
  id: Generated<string>;
  owner_id: OwnerId;
  connection_id: string;
  provider_activity_id: string;
  activity_id: string;
  latest_source_record_id: string;
  identity_fingerprint: string;
  fingerprint_version: 1;
  availability: 'available' | 'deleted' | 'inaccessible';
  provider_updated_at: NullableTimestamp;
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface ProviderWebhookEventsTable {
  id: Generated<string>;
  owner_id: string | null;
  provider: 'strava';
  event_key: string;
  provider_account_id: string;
  provider_object_id: string | null;
  aspect: 'create' | 'update' | 'delete' | 'deauthorize';
  raw_json: Json;
  received_at: GeneratedTimestamp;
  processed_at: NullableTimestamp;
  processing_error: string | null;
}

export interface Database {
  accounts: AccountsTable;
  external_identities: ExternalIdentitiesTable;
  auth_sessions: AuthSessionsTable;
  auth_transactions: AuthTransactionsTable;
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
  provider_connections: ProviderConnectionsTable;
  provider_credentials: ProviderCredentialsTable;
  provider_oauth_transactions: ProviderOauthTransactionsTable;
  provider_sync_jobs: ProviderSyncJobsTable;
  provider_activity_links: ProviderActivityLinksTable;
  provider_webhook_events: ProviderWebhookEventsTable;
  v_daily_summary: Omit<DailyMetricsTable, 'owner_id' | 'source_record_id'> & { points_delta_vs_excel: number | null; avg_10d: number | null; avg_20d: number | null; avg_30d: number | null; avg_60d: number | null; avg_365d: number | null };
  v_performance_events: Omit<PerformanceEventsTable, 'owner_id' | 'source_record_hash'> & { all_time_rank: number; is_pr_by_time: boolean };
}

export type Account = Selectable<AccountsTable>;
export type NewAccount = Insertable<AccountsTable>;
export type ExternalIdentity = Selectable<ExternalIdentitiesTable>;
export type AuthSession = Selectable<AuthSessionsTable>;
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
export type ProviderConnection = Selectable<ProviderConnectionsTable>;
export type ProviderCredential = Selectable<ProviderCredentialsTable>;
export type ProviderSyncJob = Selectable<ProviderSyncJobsTable>;
export type ProviderActivityLink = Selectable<ProviderActivityLinksTable>;
