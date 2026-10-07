import type { Generated } from 'kysely';
import type { DateString, GeneratedTimestamp, Json, OwnerId, Timestamp } from './schema.js';
export const GARMIN_DAY_CATEGORIES = ['summary', 'weight', 'sleep', 'heart_rate', 'hrv', 'stress', 'body_battery', 'activities'] as const;
export type GarminDayCategory = typeof GARMIN_DAY_CATEGORIES[number];
export type GarminDayAvailability = 'available' | 'not_recorded' | 'unsupported' | 'private';
export type GarminDayState = GarminDayAvailability | 'failed' | 'authentication_required' | 'rate_limited';
export interface GarminDayVersionsTable {
  id: Generated<string>; owner_id: OwnerId; calendar_date: DateString; category: GarminDayCategory;
  source_hash: string; origin: Generated<'garmin_connect'>; availability: GarminDayAvailability;
  projection_json: Json; retrieved_at: Timestamp;
}
export interface GarminDayHeadsTable {
  owner_id: OwnerId; calendar_date: DateString; category: GarminDayCategory; version_id: string | null;
  state: GarminDayState; attempt_json: Json; attempted_at: Timestamp;
}
/** Exists only in the separate detail database. */
export interface GarminDayResourcesTable {
  owner_id: OwnerId; calendar_date: DateString; category: GarminDayCategory; source_hash: string;
  payload_json: Json; created_at: GeneratedTimestamp;
}
