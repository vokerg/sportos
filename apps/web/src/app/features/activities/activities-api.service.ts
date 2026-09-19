import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ApiService } from '../../api.service';

export type ActivityType = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'bonus';
export type ActivitySource = 'manual' | 'my_sport_xlsx' | 'run_db_xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit';
export interface Activity {
  id: string;
  activity_date: string;
  start_time: string | null;
  activity_type: ActivityType;
  subtype: string | null;
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
  provenance: { sourceRecordId: string | null; sourceRecordSource: string | null };
}
export interface ActivitiesQuery {
  from?: string;
  to?: string;
  activityType?: ActivityType;
  source?: ActivitySource;
  limit?: number;
  offset?: number;
}
export interface ActivitiesResponse {
  items: Activity[];
  summary: { count: number; durationS: number; distanceM: number };
  limit: number;
  offset: number;
}

@Injectable({ providedIn: 'root' })
export class ActivitiesApiService {
  constructor(private readonly http: HttpClient, private readonly api: ApiService) {}

  list(query: ActivitiesQuery) {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params = params.set(key, String(value));
    return this.http.get<ActivitiesResponse>(`${this.api.apiBase()}/activities`, { params });
  }

  detail(id: string) {
    return this.http.get<ActivityDetail>(`${this.api.apiBase()}/activities/${encodeURIComponent(id)}`);
  }
}
