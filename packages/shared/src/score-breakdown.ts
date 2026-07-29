import { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format.')
  .refine(isRealIsoDate, 'Date must be a real calendar date.');

export const ImportBatchReferenceSchema = z
  .object({
    id: z.string().uuid(),
    source: z.string().min(1),
    filename: z.string().nullable(),
    originalSha256: z.string().nullable(),
    status: z.enum(['started', 'parsed', 'normalized', 'scored', 'failed']),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export const SourceRecordReferenceSchema = z
  .object({
    id: z.string().uuid(),
    rowHash: z.string().min(1),
    sheetName: z.string().nullable(),
    rowIndex: z.number().int().nullable(),
    batch: ImportBatchReferenceSchema,
  })
  .strict();

export const ScoreBreakdownActivitySchema = z
  .object({
    id: z.string().uuid(),
    source: z.enum(['manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets', 'strava', 'garmin', 'fit']),
    sourceActivityId: z.string().nullable(),
    activityDate: IsoDateSchema,
    startTime: z.string().datetime().nullable(),
    activityType: z.enum(['steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'power_bonus']),
    subtype: z.enum(['outdoor', 'indoor', 'treadmill', 'manual', 'race', 'unknown']).nullable(),
    distanceM: z.number().nullable(),
    durationS: z.number().int().nullable(),
    movingTimeS: z.number().int().nullable(),
    steps: z.number().int().nullable(),
    calories: z.number().int().nullable(),
    avgHr: z.number().int().nullable(),
    maxHr: z.number().int().nullable(),
    elevationGainM: z.number().nullable(),
    avgSpeedMps: z.number().nullable(),
    avgPaceSPerKm: z.number().nullable(),
    effortPoints: z.number().nullable(),
    notes: z.string().nullable(),
    sourceRecord: SourceRecordReferenceSchema.nullable(),
  })
  .strict();

export const ScoreBreakdownRuleSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    activityType: z.enum(['steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'power_bonus']),
    ruleKind: z.enum(['coefficient', 'achievement', 'manual_points']),
    metric: z.string().min(1),
    coefficient: z.number().nullable(),
    thresholdOperator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq', 'exists']).nullable(),
    thresholdValue: z.number().nullable(),
    thresholdUnit: z.string().nullable(),
    configuredPoints: z.number().int().nullable(),
    validFrom: IsoDateSchema,
    validTo: IsoDateSchema.nullable(),
    priority: z.number().int(),
    enabled: z.boolean(),
    description: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const ScoreBreakdownLedgerEntrySchema = z
  .object({
    id: z.string().uuid(),
    points: z.number().int(),
    reason: z.string().min(1),
    calculation: JsonValueSchema,
    createdAt: z.string().datetime(),
    rule: ScoreBreakdownRuleSchema.nullable(),
    activity: ScoreBreakdownActivitySchema.nullable(),
  })
  .strict();

export const DailyScoreBreakdownSchema = z
  .object({
    date: IsoDateSchema,
    recomputedAt: z.string().datetime(),
    facts: z
      .object({
        steps: z.number().int(),
        runM: z.number(),
        bikeM: z.number(),
        swimM: z.number(),
        workoutPoints: z.number().int(),
        powerPoints: z.number().int(),
      })
      .strict(),
    score: z
      .object({
        appTotal: z.number().int(),
        excelTotal: z.number().nullable(),
        delta: z.number().nullable(),
        baseTotal: z.number().int(),
        bonusTotal: z.number().int(),
        ledgerTotal: z.number().int(),
      })
      .strict(),
    sourceRecord: SourceRecordReferenceSchema.nullable(),
    ledger: z.array(ScoreBreakdownLedgerEntrySchema),
  })
  .strict()
  .superRefine((value, context) => {
    const ledgerSum = value.ledger.reduce((sum, entry) => sum + entry.points, 0);
    if (ledgerSum !== value.score.ledgerTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score', 'ledgerTotal'],
        message: 'ledgerTotal must equal the sum of ledger entry points.',
      });
    }
    if (value.score.ledgerTotal !== value.score.appTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score', 'appTotal'],
        message: 'appTotal must equal ledgerTotal.',
      });
    }
    if (value.score.baseTotal + value.score.bonusTotal !== value.score.appTotal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score'],
        message: 'baseTotal plus bonusTotal must equal appTotal.',
      });
    }
    const expectedDelta = value.score.excelTotal === null ? null : value.score.appTotal - value.score.excelTotal;
    if (expectedDelta === null ? value.score.delta !== null : value.score.delta === null || Math.abs(value.score.delta - expectedDelta) > 1e-9) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score', 'delta'],
        message: 'delta must be null without an Excel total, otherwise appTotal minus excelTotal.',
      });
    }
  });

export type DailyScoreBreakdown = z.infer<typeof DailyScoreBreakdownSchema>;
export type ScoreBreakdownLedgerEntry = z.infer<typeof ScoreBreakdownLedgerEntrySchema>;

function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
