import { HttpErrorResponse } from '@angular/common/http';

export function describeImportUploadError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'The file upload failed. Try again.';
  if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
  if (error.status === 413) return 'The workbook exceeds the 20 MB upload limit.';

  const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {};
  const code = typeof body.code === 'string' ? body.code : '';
  if (code === 'DUPLICATE_UPLOAD') {
    const duplicate = body.duplicate && typeof body.duplicate === 'object'
      ? body.duplicate as Record<string, unknown>
      : {};
    const filename = typeof duplicate.filename === 'string' ? duplicate.filename : 'This file';
    const status = typeof duplicate.batchStatus === 'string' ? ` Its batch is ${duplicate.batchStatus}.` : '';
    return `${filename} was already uploaded.${status} Select the existing batch in history instead of importing it again.`;
  }
  if (code === 'IMPORT_QUEUE_FULL') return 'The import queue is full. Wait for an active job to finish, then upload again.';
  if (code === 'UPLOAD_STORAGE_FAILED') return 'The file could not be stored. No import job was created.';
  if (code === 'IMPORT_JOB_ENQUEUE_FAILED') return 'The file was not queued. No import was started.';

  const actionableCodes = new Set([
    'UPLOAD_FILE_REQUIRED',
    'INVALID_WORKBOOK_KIND',
    'UNSUPPORTED_FILE_EXTENSION',
    'UNSUPPORTED_MEDIA_TYPE',
    'EMPTY_UPLOAD',
    'UPLOAD_TOO_LARGE',
    'INVALID_XLSX',
    'INVALID_GARMIN_CSV',
    'UNSUPPORTED_GARMIN_REPORT',
    'GARMIN_CSV_TOO_MANY_ROWS',
  ]);
  if (actionableCodes.has(code) && typeof body.message === 'string') return body.message;
  return `The file upload failed. The API returned HTTP ${error.status}.`;
}

export function describeImportRequestError(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API and worker are running.';
  if (error.status === 404) return 'The selected import job or batch no longer exists.';
  const body = error.error && typeof error.error === 'object' ? error.error as Record<string, unknown> : {};
  return typeof body.message === 'string' ? body.message : `${fallback} The API returned HTTP ${error.status}.`;
}
