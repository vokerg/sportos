import type { ImportDiagnostic, ImportJob } from './imports.models';

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
  const garminObservations = safeCount(result.garminObservations);
  if (job.workbookKind === 'garmin_csv') {
    const inserted = safeCount(result.garminInserted);
    const unchanged = safeCount(result.garminUnchanged);
    const updated = safeCount(result.garminUpdated);
    return `Garmin staging completed: ${garminObservations} observations (${inserted} new, ${updated} updated, ${unchanged} unchanged) and ${warnings} warnings. Scores were not recalculated.`;
  }
  return `Import completed: ${dailyRows} daily rows, ${activities} activities, ${performanceEvents} performance events, and ${warnings} warnings.`;
}

export function isActiveImportJob(job: ImportJob | null): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

export function isTerminalImportJob(job: ImportJob): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
}

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
