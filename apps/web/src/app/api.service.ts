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
export type UploadWorkbookKind = 'my_sport' | 'run_db';
export type ImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type ActivityType = 'steps' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit' | 'power_bonus';
export type RuleKind = 'coefficient' | 'achievement' | 'manual_points';
export type ThresholdOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'exists';
export type RuleChangeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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

export interface ImportJob {
  id: string;
  uploadId: string;
  batchId: string | null;
  filename: string;
  workbookKind: UploadWorkbookKind;
  uploadStatus: 'stored' | 'imported' | 'failed' | 'deleted';
  status: ImportJobStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  error: { code: string; message: string } | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface UploadWorkbookResponse {
  upload: {
    id: string;
    filename: string;
    workbookKind: UploadWorkbookKind;
    byteSize: number;
    sha256: string;
    status: 'stored';
  };
  job: ImportJob;
}

export interface RuleProposal {
  replaceRuleId?: string;
  code: string;
  name: string;
  activityType: ActivityType;
  ruleKind: RuleKind;
  metric: string;
  coefficient?: number;
  thresholdOperator?: ThresholdOperator;
  thresholdValue?: number;
  thresholdUnit?: string;
  points?: number;
  validFrom: string;
  validTo?: string;
  priority: number;
  description?: string;
}

export interface RuleVersion extends Omit<RuleProposal, 'replaceRuleId'> {
  id: string;
  version: number;
  supersedesRuleId: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface RulePreviewRow {
  metricDate: string;
  currentBasePoints: number;
  proposedBasePoints: number;
  currentBonusPoints: number;
  proposedBonusPoints: number;
  currentTotalPoints: number;
  proposedTotalPoints: number;
  delta: number;
}

export interface RulePreviewResponse {
  proposal: RuleProposal;
  preview: {
    affectedFrom: string;
    affectedTo: string;
    totalDates: number;
    changedDates: number;
    aggregateDelta: number;
    minimumDelta: number;
    maximumDelta: number;
    rows: RulePreviewRow[];
  };
  previewFingerprint: string;
}

export interface RuleChange {
  id: string;
  ruleCode: string;
  previousRuleId: string | null;
  proposedRuleId: string;
  status: RuleChangeStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  initiatedBy: string;
  reason: string;
  proposal: RuleProposal;
  preview: RulePreviewResponse['preview'];
  previewFingerprint: string;
  affectedFrom: string;
  affectedTo: string;
  error: { code: string; message: string } | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
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

  uploadWorkbook(file: File, workbookKind: UploadWorkbookKind) {
    const body = new FormData();
    body.append('file', file, file.name);
    body.append('workbookKind', workbookKind);
    return this.http.post<UploadWorkbookResponse>(`${this.apiBase()}/imports/upload`, body, {
      observe: 'events',
      reportProgress: true,
    });
  }

  importJob(jobId: string) {
    return this.http.get<ImportJob>(`${this.apiBase()}/imports/jobs/${encodeURIComponent(jobId)}`);
  }

  retryImportJob(jobId: string) {
    return this.http.post<ImportJob>(`${this.apiBase()}/imports/jobs/${encodeURIComponent(jobId)}/retry`, {});
  }

  cancelImportJob(jobId: string) {
    return this.http.post<ImportJob>(`${this.apiBase()}/imports/jobs/${encodeURIComponent(jobId)}/cancel`, {});
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

  ruleVersions() {
    return this.http.get<RuleVersion[]>(`${this.apiBase()}/rules`);
  }

  previewRule(proposal: RuleProposal) {
    return this.http.post<RulePreviewResponse>(`${this.apiBase()}/rules/preview`, proposal);
  }

  activateRule(proposal: RuleProposal, previewFingerprint: string, reason: string) {
    return this.http.post<RuleChange>(`${this.apiBase()}/rules/activate`, {
      proposal,
      previewFingerprint,
      reason,
      initiatedBy: 'local-user',
    });
  }

  ruleChanges(limit = 50) {
    return this.http.get<RuleChange[]>(`${this.apiBase()}/rules/changes?limit=${limit}`);
  }

  ruleChange(changeId: string) {
    return this.http.get<RuleChange>(`${this.apiBase()}/rules/changes/${encodeURIComponent(changeId)}`);
  }

  retryRuleChange(changeId: string) {
    return this.http.post<RuleChange>(`${this.apiBase()}/rules/changes/${encodeURIComponent(changeId)}/retry`, {});
  }

  cancelRuleChange(changeId: string) {
    return this.http.post<RuleChange>(`${this.apiBase()}/rules/changes/${encodeURIComponent(changeId)}/cancel`, {});
  }
}
