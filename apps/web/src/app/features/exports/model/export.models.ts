export interface CanonicalExportBundle {
  schemaVersion: 'sportos.canonical-export.v3';
  generatedAt: string;
  dateRange: { from: string; to: string };
  rowCounts: { dailySummaries: number; activities: number; performanceEvents: number };
  dailySummaries: unknown[];
  activities: unknown[];
  performanceEvents: unknown[];
}
