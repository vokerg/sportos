import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../core/config/api-base';

export type ActivityType = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus';
export type ActivitySubtype = 'outdoor' | 'indoor' | 'treadmill' | 'track' | 'manual' | 'race' | 'unknown';
export type ActivitySource = 'manual' | 'my_sport_xlsx' | 'run_db_xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit';
export interface Activity {
  id: string;
  activity_date: string;
  start_time: string | null;
  activity_type: ActivityType;
  subtype: ActivitySubtype | null;
  source: ActivitySource;
  source_activity_id: string | null;
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
}
export interface ActivityDetail extends Activity {
  garminStrength?: { workingSets: number; totalRecordedSets: number; warmupSets: number; restMarkers: number;
    unknownSets: number; exerciseCount: number; complete: boolean; policyVersion: number; sourceUpdatedAt: string;
    exercises: Array<{name: string; workingSets: number}> } | null;
  garmin?: { provider: 'garmin'; identityId: string; providerActivityId: string | null; status: string } | null;
  provenance: { sourceRecordId: string | null; sourceRecordSource: string | null };
  providerDetail: { provider: 'strava'; providerActivityId: string } | null;
}
export interface ActivityProviderDetailResource {
  availability: 'available' | 'unavailable';
  httpStatus: number | null;
  payload: unknown;
}
export interface ActivityProviderDetailResponse {
  provider: 'strava';
  providerActivityId: string;
  fetchedAt: string;
  cacheStatus: 'hit' | 'miss';
  resources: Record<string, ActivityProviderDetailResource>;
}
export interface ActivitySourceJson {
  sourceRecordId: string;
  sourceRecordSource: string;
  rawJson: unknown;
}
export interface ActivitiesQuery {
  from?: string;
  to?: string;
  activityType?: ActivityType;
  source?: ActivitySource;
  subtype?: ActivitySubtype;
  minDistanceM?: number;
  paceUnderSPerKm?: number;
  minAvgSpeedMps?: number;
  swimPaceUnderSPer100m?: number;
  limit?: number;
  offset?: number;
}
export interface ActivitiesResponse {
  items: Activity[];
  summary: { count: number; durationS: number; distanceM: number; avgDistanceM: number | null; avgPaceSPerKm: number | null };
  limit: number;
  offset: number;
}

export interface EnrichmentStatus {
  strava: { state: 'cached' | 'missing' | 'stale' | 'unavailable' };
  garmin: { state: 'cached' | 'linked' | 'missing'; linked: boolean; fetchEnabled: boolean };
}
export interface FitMessage { message: string; fields: { name: string; units: string | null; value: unknown }[] }
export interface GarminDetail {
  provider: 'garmin'; retainedAt: string; cacheStatus?: 'hit' | 'miss';
  sessions: FitMessage[]; laps: FitMessage[]; sets: unknown;
  resources: { resourceType: string; chunkIndex: number }[];
}

@Injectable({ providedIn: 'root' })
export class ActivitiesApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  list(query: ActivitiesQuery) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params = params.set(key, String(value));
    return this.http.get<ActivitiesResponse>(`${this.apiBase}/activities`, { params });
  }

  detail(id: string) {
    return this.http.get<ActivityDetail>(`${this.apiBase}/activities/${encodeURIComponent(id)}`);
  }

  providerDetail(id: string) {
    return this.http.get<ActivityProviderDetailResponse>(`${this.apiBase}/activities/${encodeURIComponent(id)}/provider-detail`);
  }

  enrichment(id: string) { return this.http.get<EnrichmentStatus>(`${this.apiBase}/activities/${encodeURIComponent(id)}/enrichment`); }
  fetchProviderDetail(id: string, refresh = false) { return this.http.post<ActivityProviderDetailResponse>(`${this.apiBase}/activities/${encodeURIComponent(id)}/provider-detail`, { refresh }); }
  garminDetail(id: string) { return this.http.get<GarminDetail>(`${this.apiBase}/activities/${encodeURIComponent(id)}/garmin-detail`); }
  fetchGarminDetail(id: string, refresh = false) { return this.http.post<GarminDetail>(`${this.apiBase}/activities/${encodeURIComponent(id)}/garmin-detail`, { refresh }); }
  garminResource(id: string, resourceType: string, chunkIndex: number) { return this.http.get<{ payload: unknown }>(`${this.apiBase}/activities/${encodeURIComponent(id)}/garmin-detail/resource`, { params: { resourceType, chunkIndex } }); }

  sourceJson(id: string) {
    return this.http.get<ActivitySourceJson>(`${this.apiBase}/activities/${encodeURIComponent(id)}/source`);
  }
}
