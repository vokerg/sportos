import type { Generated } from 'kysely';
import type { ActivityMatchSummary, ActivityMatchResult } from '@sportos/domain';
import type { OwnerId, GeneratedTimestamp, Timestamp, Json } from './schema.js';
export interface GarminActivityIdentitiesTable {
  id: Generated<string>; owner_id: OwnerId; provider: Generated<'garmin'>;
  identity_key: string; identity_kind: 'native' | 'fingerprint_v1';
  activity_id: string | null;
  status: ActivityMatchResult['status'] | 'manual' | 'rejected';
  activity_type: ActivityMatchSummary['activityType']; subtype: ActivityMatchSummary['subtype'];
  start_time: Timestamp; elapsed_time_s: number | null; moving_time_s: number | null; distance_m: number | null;
  current_hash: string; source_updated_at: Timestamp; match_evidence: Json;
  created_at: GeneratedTimestamp; updated_at: GeneratedTimestamp;
}
export interface GarminActivityVersionsTable {
  id: Generated<string>; owner_id: OwnerId; identity_id: string; content_hash: string;
  origin: 'archive' | 'connect'; source_updated_at: Timestamp; summary_json: Json; created_at: GeneratedTimestamp;
}
export interface GarminReconciliationAuditTable {
  id: Generated<string>; owner_id: OwnerId; identity_id: string; activity_id: string | null;
  action: 'auto_link' | 'manual_link' | 'reject' | 'reopen'; policy_version: 1;
  evidence_json: Json; created_at: GeneratedTimestamp;
}

/** Exists only in the separate activity-detail database. */
export interface GarminActivityResourcesTable {
  id: Generated<string>; owner_id: OwnerId; identity_key: string; source_hash: string;
  resource_type: 'detail' | 'sets' | 'laps' | 'records' | 'fit_manifest';
  chunk_index: number; resource_hash: string; payload_json: Json; created_at: GeneratedTimestamp;
}
export interface GarminStrengthSummariesTable {
  owner_id: OwnerId; identity_id: string; content_hash: string; version_id: string;
  policy_version: 1; total_recorded_sets: number; working_sets: number;
  warmup_sets: number; rest_markers: number; unknown_sets: number;
  exercise_count: number; exercises_json: Json; complete: boolean; derived_at: GeneratedTimestamp;
}
