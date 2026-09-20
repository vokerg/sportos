export type ImportBatchStatus = 'started' | 'parsed' | 'normalized' | 'scored' | 'failed';
export type UploadWorkbookKind = 'my_sport' | 'run_db' | 'garmin_csv';
export type ImportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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
  failure: { phase: string; name: string; message: string; recordedAt: string } | null;
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
  transitions: Array<{ status: ImportBatchStatus; phase: string; recordedAt: string }>;
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
