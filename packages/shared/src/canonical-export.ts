import { z } from 'zod';
import { ActivitySubtypeSchema, ActivityTypeSchema } from './schemas.js';

export const CANONICAL_EXPORT_SCHEMA_VERSION = 'sportos.canonical-export.v1' as const;

export const ExportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
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
});

export type ExportProvenance = z.infer<typeof ExportProvenanceSchema>;
export type CanonicalDailyExportRow = z.infer<typeof CanonicalDailyExportRowSchema>;
export type CanonicalActivityExportRow = z.infer<typeof CanonicalActivityExportRowSchema>;
export type CanonicalPerformanceExportRow = z.infer<typeof CanonicalPerformanceExportRowSchema>;
export type CanonicalExportBundle = z.infer<typeof CanonicalExportBundleSchema>;
