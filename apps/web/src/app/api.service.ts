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

export type ImportBatchStatus = 'started' | 'parsed' | 'normalized' | 'scored' | 'failed';

export interface ImportBatchHistoryItem {
  id: string;
  source: string;
  sourceKind: 'xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit' | 'manual';
  filename: string | null;
  status: ImportBatchStatus;
  rowCount: number;
  normalizedCount: number;
  warningCount: number;
  errorCount: number;
  startedAt: string;
  completedAt: string | null;
  affectedDates: string[];
  failure: {
    phase: string;
    name: string;
    message: string;
    recordedAt: string;
  } | null;
}

export interface ImportBatchHistoryPage {
  items: ImportBatchHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  phase: string;
  sheetName: string | null;
  rowIndex: number | null;
  sourceRecordId: string | null;
  recordedAt: string | null;
}

export interface ImportBatchDetail {
  batch: ImportBatchHistoryItem;
  transitions: Array<{
    status: ImportBatchStatus;
    phase: string;
    recordedAt: string;
  }>;
  diagnostics: ImportDiagnostic[];
  diagnosticTotal: number;
  diagnosticLimit: number;
  diagnosticOffset: number;
}

export interface ImportLocalFilesResponse {
  batches: Array<{ id: string; filename: string | null; source: string }>;
  dailyRows: number;
  activities: number;
  performanceEvents: number;
  warnings: string[];
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
    return this.http.post<ImportLocalFilesResponse>(`${this.apiBase()}/imports/local-files`, { mySportPath, runDbPath });
  }

  importHistory(limit = 20, offset = 0) {
    return this.http.get<ImportBatchHistoryPage>(`${this.apiBase()}/imports?limit=${limit}&offset=${offset}`);
  }

  importBatchDetail(batchId: string, diagnosticLimit = 100, diagnosticOffset = 0) {
    return this.http.get<ImportBatchDetail>(
      `${this.apiBase()}/imports/${encodeURIComponent(batchId)}?diagnosticLimit=${diagnosticLimit}&diagnosticOffset=${diagnosticOffset}`,
    );
  }
}
