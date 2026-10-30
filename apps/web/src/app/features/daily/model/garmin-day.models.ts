import type {GarminFetchJob} from '../../../shared/model/garmin-job';
export type GarminDayCategory = 'summary' | 'weight' | 'sleep' | 'heart_rate' | 'hrv' | 'stress' | 'body_battery' | 'activities';
export type GarminDayCategoryState = 'missing' | 'available' | 'not_recorded' | 'unsupported' | 'private' | 'failed' | 'authentication_required' | 'rate_limited';
export interface GarminDayMeasurement {
  recordedAt: string | null; weightKg: number | null; bmi: number | null; bodyFatPct: number | null;
  muscleMassKg: number | null; boneMassKg: number | null; bodyWaterPct: number | null;
}
export interface GarminDayActivity { ordinal: number; activityId: string | null; reconciliation: string; resourceState: string; }
export interface GarminDayEvidence {
  [key: string]: unknown;
  measurements?: GarminDayMeasurement[]; activities?: GarminDayActivity[]; count?: number; complete?: boolean; uncoveredStravaActivities?: boolean;
}
export interface GarminDayCategoryEvidence {
  category: GarminDayCategory; state: GarminDayCategoryState; retainedState: string | null;
  retainedAt: string | null; attemptedAt: string | null; resourceAvailable: boolean; evidence: GarminDayEvidence | null;
}
export interface GarminDay {
  activeJob?:GarminFetchJob|null; fetchAvailability?:string;
  date: string; origin: 'garmin_connect'; evidenceOnly: true; fetchEnabled: boolean;
  state: 'missing' | 'partial' | 'current'; result: 'cached' | 'fetched' | null; categories: GarminDayCategoryEvidence[];
  completeness: 'in_progress' | 'refresh_required' | 'complete';
}
export const GARMIN_CATEGORY_LABELS: Record<GarminDayCategory, string> = {
  summary: 'Movement and energy', weight: 'Body measurements', sleep: 'Sleep', heart_rate: 'Heart rate',
  hrv: 'HRV', stress: 'Stress', body_battery: 'Body Battery', activities: 'Activities',
};
