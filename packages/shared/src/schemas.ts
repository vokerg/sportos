import { z } from 'zod';

export const ActivityTypeSchema = z.enum([
  'steps',
  'run',
  'bike',
  'swim',
  'workout',
  'rowing',
  'sup',
  'hiit',
  'power_bonus',
]);

export const ActivitySubtypeSchema = z.enum([
  'outdoor',
  'indoor',
  'treadmill',
  'manual',
  'race',
  'unknown',
]);

export const ImportSourceKindSchema = z.enum([
  'xlsx',
  'google_sheets',
  'strava',
  'garmin',
  'fit',
  'manual',
]);

export const CanonicalActivitySchema = z.object({
  source: z.enum(['manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets', 'strava', 'garmin', 'fit']),
  sourceRecordId: z.string().uuid().optional(),
  sourceActivityId: z.string().optional(),
  sourceRecordHash: z.string().optional(),
  activityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().datetime().optional(),
  activityType: ActivityTypeSchema,
  subtype: ActivitySubtypeSchema.default('unknown'),
  distanceM: z.number().nonnegative().optional(),
  durationS: z.number().int().nonnegative().optional(),
  movingTimeS: z.number().int().nonnegative().optional(),
  steps: z.number().int().nonnegative().optional(),
  calories: z.number().int().nonnegative().optional(),
  avgHr: z.number().int().nonnegative().optional(),
  maxHr: z.number().int().nonnegative().optional(),
  elevationGainM: z.number().nonnegative().optional(),
  avgSpeedMps: z.number().nonnegative().optional(),
  avgPaceSPerKm: z.number().nonnegative().optional(),
  effortPoints: z.number().int().optional(),
  notes: z.string().optional(),
  rawPayloadJson: z.record(z.unknown()).default({}),
});

export const DailyMetricInputSchema = z.object({
  metricDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().default(0),
  runM: z.number().default(0),
  runIndoorM: z.number().nonnegative().optional(),
  runOutdoorM: z.number().nonnegative().optional(),
  bikeM: z.number().default(0),
  bikeIndoorM: z.number().nonnegative().optional(),
  bikeOutdoorM: z.number().nonnegative().optional(),
  swimM: z.number().default(0),
  workoutPoints: z.number().int().default(0),
  powerPoints: z.number().int().default(0),
  excelAllPoints: z.number().optional(),
  excelRowHash: z.string().optional(),
});

export const PerformanceEventInputSchema = z.object({
  source: z.enum(['manual', 'run_db_xlsx', 'strava', 'garmin', 'fit']),
  sourceRecordId: z.string().uuid().optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  distanceM: z.number().positive(),
  durationS: z.number().int().positive(),
  paceSPerKm: z.number().positive(),
  isTreadmill: z.boolean().default(false),
  isRace: z.boolean().default(false),
  isPrMarker: z.boolean().default(false),
  sourceRank: z.number().int().positive().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  rawPayloadJson: z.record(z.unknown()).default({}),
});

export type CanonicalActivityInput = z.infer<typeof CanonicalActivitySchema>;
export type DailyMetricInput = z.infer<typeof DailyMetricInputSchema>;
export type PerformanceEventInput = z.infer<typeof PerformanceEventInputSchema>;
