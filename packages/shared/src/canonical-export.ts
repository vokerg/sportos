import { z } from 'zod';
import { isRealIsoDate } from './dates.js';
import { ActivitySubtypeSchema, ActivityTypeSchema } from './schemas.js';

export const CANONICAL_EXPORT_SCHEMA_VERSION = 'sportos.canonical-export.v1' as const;

export const ExportDateSchema = z.string().refine(isRealIsoDate, {
  message: 'Expected a real calendar date in YYYY-MM-DD format.',
});
export const ExportTimestampSchema = z.string().datetime({ offset: true });

export const ExportProvenanceStatusSchema = z.enum(['available', 'missing', 'unsupported']);

export const ExportProvenanceSchema = z.object({
  status: ExportProvenanceStatusSchema,
  sourceRecordId: z.string().uuid().nullable(),
  sourceRecordHash: z.string().nullable(),
  importBatchId: z.string().uuid().nullable(),
  source: z.string().nullable(),
  sheetName: z.string().nullable(),
  rowIndex: z.number().int().positive().nullable(),
  filename: z.string().nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'available') {
    if (!value.sourceRecordId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceRecordId'], message: 'Available provenance requires a source record id.' });
    }
    if (!value.importBatchId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['importBatchId'], message: 'Available provenance requires an import batch id.' });
    }
    return;
  }
  if (value.sourceRecordId !== null || value.importBatchId !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: `${value.status} provenance cannot claim traceable source identifiers.`,
    });
  }
});

export const ExportReconciliationStatusSchema = z.enum([
  'exact',
  'explained',
  'unresolved',
  'not_comparable',
]);

export const CanonicalDailyExportRowSchema = z.object({
  metricDate: ExportDateSchema,
  steps: z.number().int().nonnegative(),
  runM: z.number().nonnegative(),
  bikeM: z.number().nonnegative(),
  swimM: z.number().nonnegative(),
  workoutPoints: z.number().int(),
  powerPoints: z.number().int(),
  basePoints: z.number().int(),
  bonusPoints: z.number().int(),
  totalPoints: z.number().int(),
  excelAllPoints: z.number().nullable(),
  pointsDeltaVsExcel: z.number().nullable(),
  reconciliationStatus: ExportReconciliationStatusSchema,
  avg10d: z.number().nullable(),
  avg20d: z.number().nullable(),
  avg30d: z.number().nullable(),
  avg60d: z.number().nullable(),
  avg365d: z.number().nullable(),
  recomputedAt: ExportTimestampSchema,
  provenance: ExportProvenanceSchema,
}).strict();

export const CanonicalActivityExportRowSchema = z.object({
  id: z.string().uuid(),
  activityDate: ExportDateSchema,
  startTime: ExportTimestampSchema.nullable(),
  activityType: ActivityTypeSchema,
  subtype: ActivitySubtypeSchema.nullable(),
  source: z.enum(['manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets', 'strava', 'garmin', 'fit']),
  sourceActivityId: z.string().nullable(),
  distanceM: z.number().nonnegative().nullable(),
  durationS: z.number().int().nonnegative().nullable(),
  movingTimeS: z.number().int().nonnegative().nullable(),
  steps: z.number().int().nonnegative().nullable(),
  calories: z.number().int().nonnegative().nullable(),
  avgHr: z.number().int().nonnegative().nullable(),
  maxHr: z.number().int().nonnegative().nullable(),
  elevationGainM: z.number().nonnegative().nullable(),
  avgSpeedMps: z.number().nonnegative().nullable(),
  avgPaceSPerKm: z.number().nonnegative().nullable(),
  effortPoints: z.number().int().nullable(),
  notes: z.string().nullable(),
  provenance: ExportProvenanceSchema,
}).strict();

export const CanonicalPerformanceExportRowSchema = z.object({
  id: z.string().uuid(),
  activityId: z.string().uuid().nullable(),
  eventDate: ExportDateSchema,
  source: z.enum(['manual', 'run_db_xlsx', 'strava', 'garmin', 'fit']),
  distanceM: z.number().positive(),
  durationS: z.number().int().positive(),
  paceSPerKm: z.number().positive(),
  isTreadmill: z.boolean(),
  isRace: z.boolean(),
  isPrMarker: z.boolean(),
  sourceRank: z.number().int().positive().nullable(),
  tags: z.array(z.string()),
  notes: z.string().nullable(),
  provenance: ExportProvenanceSchema,
}).strict();

export const CanonicalExportBundleSchema = z.object({
  schemaVersion: z.literal(CANONICAL_EXPORT_SCHEMA_VERSION),
  generatedAt: ExportTimestampSchema,
  dateRange: z.object({
    from: ExportDateSchema,
    to: ExportDateSchema,
  }).strict().refine((range) => range.from <= range.to, {
    message: 'Export date range must be ordered.',
    path: ['to'],
  }),
  rowCounts: z.object({
    dailySummaries: z.number().int().nonnegative(),
    activities: z.number().int().nonnegative(),
    performanceEvents: z.number().int().nonnegative(),
  }).strict(),
  dailySummaries: z.array(CanonicalDailyExportRowSchema),
  activities: z.array(CanonicalActivityExportRowSchema),
  performanceEvents: z.array(CanonicalPerformanceExportRowSchema),
}).strict().superRefine((value, context) => {
  const actual = {
    dailySummaries: value.dailySummaries.length,
    activities: value.activities.length,
    performanceEvents: value.performanceEvents.length,
  };
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    if (value.rowCounts[key] !== actual[key]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rowCounts', key],
        message: `Declared ${key} count does not match the dataset.`,
      });
    }
  }

  validateDatesAndOrder(value.dailySummaries, (row) => row.metricDate, (row) => row.metricDate, value.dateRange, 'dailySummaries', context);
  validateDatesAndOrder(value.activities, (row) => row.activityDate, (row) => `${row.activityDate}:${row.id}`, value.dateRange, 'activities', context);
  validateDatesAndOrder(value.performanceEvents, (row) => row.eventDate, (row) => `${row.eventDate}:${row.id}`, value.dateRange, 'performanceEvents', context);
});

function validateDatesAndOrder<T>(
  rows: T[],
  dateOf: (row: T) => string,
  keyOf: (row: T) => string,
  range: { from: string; to: string },
  path: string,
  context: z.RefinementCtx,
): void {
  let previous = '';
  rows.forEach((row, index) => {
    const date = dateOf(row);
    if (date < range.from || date > range.to) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path, index], message: 'Export row falls outside the declared date range.' });
    }
    const key = keyOf(row);
    if (index > 0 && key < previous) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path, index], message: 'Export rows are not in stable ascending order.' });
    }
    previous = key;
  });
}

export type ExportProvenance = z.infer<typeof ExportProvenanceSchema>;
export type CanonicalDailyExportRow = z.infer<typeof CanonicalDailyExportRowSchema>;
export type CanonicalActivityExportRow = z.infer<typeof CanonicalActivityExportRowSchema>;
export type CanonicalPerformanceExportRow = z.infer<typeof CanonicalPerformanceExportRowSchema>;
export type CanonicalExportBundle = z.infer<typeof CanonicalExportBundleSchema>;
