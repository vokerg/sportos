import { HttpErrorResponse } from '@angular/common/http';
import type { ImportDiagnostic, ImportJob } from './api.service';

export type ImportRequestState = 'idle' | 'loading' | 'loaded' | 'error';

export function importDiagnosticLocation(diagnostic: ImportDiagnostic): string {
  if (diagnostic.sheetName && diagnostic.rowIndex) return `${diagnostic.sheetName} row ${diagnostic.rowIndex}`;
  if (diagnostic.sheetName) return diagnostic.sheetName;
  return 'Batch-level diagnostic';
}

export function importDiagnosticKey(diagnostic: ImportDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.code,
    diagnostic.message,
    diagnostic.sheetName ?? '',
    diagnostic.rowIndex ?? '',
    diagnostic.recordedAt ?? '',
  ].join('|');
}

export function importJobSuccessMessage(job: ImportJob): string {
  const result = job.result && typeof job.result === 'object'
    ? job.result as Record<string, unknown>
    : {};
  const dailyRows = safeCount(result.dailyRows);
  const activities = safeCount(result.activities);
  const performanceEvents = safeCount(result.performanceEvents);
  const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0;
  return `Import completed: ${dailyRows} daily rows, ${activities} activities, ${performanceEvents} performance events, and ${warnings} warnings.`;
}

export function isActiveImportJob(job: ImportJob | null): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

export function isTerminalImportJob(job: ImportJob): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
}

export function describeImportUploadError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'The workbook upload failed. Try again.';
  if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
  if (error.status === 413) return 'The workbook exceeds the 20 MB upload limit.';

  const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {};
  const code = typeof body.code === 'string' ? body.code : '';
  if (code === 'DUPLICATE_UPLOAD') {
    const duplicate = body.duplicate && typeof body.duplicate === 'object'
      ? body.duplicate as Record<string, unknown>
      : {};
    const filename = typeof duplicate.filename === 'string' ? duplicate.filename : 'This workbook';
    const status = typeof duplicate.batchStatus === 'string' ? ` Its batch is ${duplicate.batchStatus}.` : '';
    return `${filename} was already uploaded.${status} Select the existing batch in history instead of importing it again.`;
  }
  if (code === 'IMPORT_QUEUE_FULL') return 'The import queue is full. Wait for an active job to finish, then upload again.';
  if (code === 'UPLOAD_STORAGE_FAILED') return 'The workbook could not be stored. No import job was created.';
  if (code === 'IMPORT_JOB_ENQUEUE_FAILED') return 'The workbook was not queued. No import was started.';

  const actionableCodes = new Set([
    'UPLOAD_FILE_REQUIRED',
    'INVALID_WORKBOOK_KIND',
    'UNSUPPORTED_FILE_EXTENSION',
    'UNSUPPORTED_MEDIA_TYPE',
    'EMPTY_UPLOAD',
    'UPLOAD_TOO_LARGE',
    'INVALID_XLSX',
  ]);
  if (actionableCodes.has(code) && typeof body.message === 'string') return body.message;
  return `The workbook upload failed. The API returned HTTP ${error.status}.`;
}

export function describeImportRequestError(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API and worker are running.';
  if (error.status === 404) return 'The selected import job or batch no longer exists.';
  const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {};
  return typeof body.message === 'string' ? body.message : `${fallback} The API returned HTTP ${error.status}.`;
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
