import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';

export interface DailySummaryRow {
  metric_date: string;
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
  points_delta_vs_excel: number | null;
  avg_10d: number | null;
  avg_20d: number | null;
  avg_30d: number | null;
  avg_60d: number | null;
  avg_365d: number | null;
}

export interface PerformanceRow {
  event_date: string;
  distance_m: number;
  duration_s: number;
  pace_s_per_km: number;
  is_treadmill: boolean;
  is_pr_marker: boolean;
  source_rank: number | null;
  all_time_rank: number;
  tags: string[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly apiBase = signal('http://localhost:3000');

  constructor(private readonly http: HttpClient) {}

  dailySummary(limit = 365) {
    return this.http.get<DailySummaryRow[]>(`${this.apiBase()}/daily/summary?limit=${limit}`);
  }

  bestPerformance(distanceM: number, limit = 50) {
    return this.http.get<PerformanceRow[]>(`${this.apiBase()}/performance/best?distanceM=${distanceM}&limit=${limit}`);
  }

  importLocalFiles(mySportPath?: string, runDbPath?: string) {
    return this.http.post(`${this.apiBase()}/imports/local-files`, { mySportPath, runDbPath });
  }
}
