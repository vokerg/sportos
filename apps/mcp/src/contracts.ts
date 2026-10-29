import * as z from 'zod/v4';
export const dateSchema = z.iso.date();
const inputDateSchema = dateSchema.refine(
  (d) => d >= '1970-01-01' && d <= '2100-12-31',
  'Date outside supported range.',
);
const discipline = z.enum(['run', 'bike', 'swim']);
const page = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(50000).default(0),
};
const range = { from: inputDateSchema, to: inputDateSchema };
const validRange = (i: { from: string; to: string }) =>
  i.from <= i.to && (Date.parse(i.to) - Date.parse(i.from)) / 86400000 <= 18300;
export const snapshotInput = z.strictObject({
  asOfDate: inputDateSchema.optional(),
  windows: z
    .array(
      z.union([
        z.literal(7),
        z.literal(28),
        z.literal(30),
        z.literal(90),
        z.literal(180),
        z.literal(365),
      ]),
    )
    .min(1)
    .max(6)
    .refine((a) => new Set(a).size === a.length)
    .optional(),
});
export const volumeInput = z
  .strictObject({
    ...range,
    discipline: discipline.optional(),
    period: z.enum(['daily', 'weekly', 'monthly', 'annual']),
    ...page,
  })
  .refine(validRange, 'Invalid or excessive range.');
export const bestInput = z
  .strictObject({
    discipline,
    ...range,
    distanceM: z.number().positive().max(1000000).optional(),
    subtype: z
      .enum(['outdoor', 'indoor', 'treadmill', 'track', 'manual', 'race', 'unknown'])
      .optional(),
    ...page,
  })
  .refine(validRange, 'Invalid or excessive range.')
  .refine(
    (i) => i.discipline !== 'run' || i.subtype === undefined,
    'Running leaderboard subtype filtering is unavailable; use search_activities for conditional whole sessions.',
  );
export const searchInput = z
  .strictObject({
    ...range,
    discipline: discipline.optional(),
    source: z
      .enum(['manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets', 'strava', 'garmin', 'fit'])
      .optional(),
    subtype: z
      .enum(['outdoor', 'indoor', 'treadmill', 'track', 'manual', 'race', 'unknown'])
      .optional(),
    minDistanceM: z.number().min(0).max(1000000).optional(),
    maxDistanceM: z.number().min(0).max(1000000).optional(),
    minDurationS: z.number().min(0).max(604800).optional(),
    maxDurationS: z.number().min(0).max(604800).optional(),
    maxPaceSPerKm: z.number().positive().max(36000).optional(),
    minSpeedKmh: z.number().positive().max(360).optional(),
    ...page,
  })
  .refine(validRange, 'Invalid or excessive range.')
  .refine(
    (i) =>
      (i.minDistanceM ?? 0) <= (i.maxDistanceM ?? Infinity) &&
      (i.minDurationS ?? 0) <= (i.maxDurationS ?? Infinity),
    'Inverted filter range.',
  );
export const detailsInput = z.strictObject({
  activityId: z.uuid(),
  includeSwimLengths: z.boolean().default(false),
  lapLimit: z.number().int().min(1).max(100).default(100),
  lapOffset: z.number().int().min(0).max(10000).default(0),
  lapProvider: z.enum(['strava', 'garmin']).optional(),
  swimLengthLimit: z.number().int().min(1).max(100).default(100),
  swimLengthOffset: z.number().int().min(0).max(2000).default(0),
});
const nullable = z.number().finite().nullable();
const activityFields = {
  id: z.uuid(),
  date: dateSchema,
  discipline,
  subtype: z.string().nullable(),
  source: z.string(),
  distanceM: nullable,
  recordedDistanceM: nullable,
  distanceCorrected: z.boolean(),
  elapsedS: nullable,
  movingS: nullable,
  avgHrBpm: nullable,
  maxHrBpm: nullable,
  elevationM: nullable,
  updatedAt: z.iso.datetime(),
  historicalSummary: z.boolean(),
};
export const evidenceSchema = z.strictObject({
  ...activityFields,
  method: z.enum(['measured', 'summary_estimated']),
  evidenceType: z.literal('whole_activity'),
  durationBasis: z.enum(['moving', 'elapsed_fallback', 'unavailable']),
  paceSPerKm: nullable,
  paceSPer100m: nullable,
  speedKmh: nullable,
  caveats: z.array(z.string()).max(10),
});
const count = z.number().int().nonnegative();
export const volumeSchema = z.strictObject({
  from: dateSchema,
  to: dateSchema,
  calendarDays: z.number().int().positive(),
  sessions: count,
  activeDays: count,
  sessionsPerWeek: z.number(),
  distanceM: nullable,
  movingS: nullable,
  elapsedS: nullable,
  distanceKnown: count,
  movingKnown: count,
  elapsedKnown: count,
  averageSessionMovingS: nullable,
  medianSessionMovingS: nullable,
  averageSessionDistanceM: nullable,
  medianSessionDistanceM: nullable,
  meanSessionPaceSPerKm: nullable,
  medianSessionPaceSPerKm: nullable,
  weightedPaceSPerKm: nullable,
  pacePairedSessions: count,
  paceMovingSessions: count,
  paceElapsedFallbackSessions: count,
  meanRecordedHrBpm: nullable,
  hrKnown: count,
  elevationM: nullable,
  elevationKnown: count,
  sourceCounts: z.record(z.string(), count),
  subtypeCounts: z.record(z.string(), count),
  correctedSessions: count,
  historicalSummarySessions: count,
});
const supplement = z.strictObject({
  activityId: z.uuid(),
  provider: z.enum(['strava', 'garmin']),
  key: z.string().max(80),
  value: z.number().finite(),
  unit: z.string().max(30),
  origin: z.string().max(40),
  sourceKind: z.enum([
    'compact',
    'strava_detail',
    'fit_session',
    'strength_summary',
    'canonical_fallback',
  ]),
  method: z.enum(['measured', 'calculated']),
  projectedAt: z.iso.datetime(),
});
const runningBest = z.strictObject({
  targetDistanceM: z.number(),
  total: count,
  coverage: z.record(z.string(), count),
  rows: z
    .array(
      z.strictObject({
        activityId: z.uuid().nullable(),
        eventId: z.uuid().nullable(),
        date: dateSchema,
        durationS: z.number().positive(),
        source: z.enum(['excel', 'strava', 'garmin']),
        pausePolicy: z.string().max(80),
        rank: count,
        alternativeCount: count,
        method: z.enum(['historical_import', 'calculated']),
      }),
    )
    .max(10),
});
const disciplineSummary = z.strictObject({
  lifetime: volumeSchema,
  windows: z.array(z.strictObject({ days: z.number(), ...volumeSchema.shape })).max(6),
  longest: z.array(evidenceSchema).max(15),
  recent: z.array(evidenceSchema).max(15),
  recentLongest: z.array(evidenceSchema).max(10),
  distanceDistribution: z.array(
    z.strictObject({ minM: z.number(), maxM: nullable, sessions: count }),
  ),
  paceDistribution: z.array(
    z.strictObject({ minSPerKm: z.number(), maxSPerKm: nullable, sessions: count }),
  ),
  metrics: z
    .array(
      z.strictObject({
        key: z.string(),
        unit: z.string(),
        sessions: count,
        mean: nullable,
        median: nullable,
        min: z.number(),
        max: z.number(),
        evidence: z.array(supplement).max(5),
      }),
    )
    .max(100),
  wholeActivityBenchmarks: z
    .array(
      z.strictObject({
        targetDistanceM: z.number(),
        toleranceM: z.number(),
        candidates: z.array(evidenceSchema).max(5),
      }),
    )
    .max(10),
});
const bucket = z.strictObject({
  key: dateSchema,
  partial: z.boolean(),
  disciplines: z.strictObject({ run: volumeSchema, bike: volumeSchema, swim: volumeSchema }),
});
const numericProfileSchema = z.strictObject({
  known: count,
  missing: count,
  min: nullable,
  p10: nullable,
  p25: nullable,
  median: nullable,
  p75: nullable,
  p90: nullable,
  max: nullable,
  mean: nullable,
});
const referenceSchema = z.strictObject({
  activityId: z.uuid(),
  date: dateSchema,
  source: z.string(),
  subtype: z.string().nullable(),
  distanceM: nullable,
  elapsedS: nullable,
  movingS: nullable,
  paceSPerKm: nullable,
  distanceCorrected: z.boolean(),
  method: z.enum(['measured', 'summary_estimated']),
});
const histogramSchema = z.strictObject({
  unit: z.string(),
  known: count,
  missing: count,
  bins: z.array(z.strictObject({ min: z.number(), max: nullable, sessions: count })).max(12),
});
const metricProfileSchema = z.strictObject({
  key: z.string(),
  unit: z.string(),
  sessions: count,
  stats: numericProfileSchema,
  sourceCounts: z.record(z.string(), count),
  originCounts: z.record(z.string(), count),
  firstDate: dateSchema,
  lastDate: dateSchema,
  evidence: z
    .array(
      z.strictObject({
        activityId: z.uuid(),
        date: dateSchema,
        value: z.number(),
        source: z.string(),
        origin: z.string(),
        unit: z.string(),
      }),
    )
    .max(2),
});
const profilePeriodSchema = z.strictObject({
  key: z.string(),
  evidenceId: z.string(),
  volume: volumeSchema,
  sessionDistance: numericProfileSchema,
  sessionMoving: numericProfileSchema,
  sessionElapsed: numericProfileSchema,
  sessionRate: numericProfileSchema,
  rateUnit: z.string(),
  distributions: z.strictObject({
    distance: histogramSchema,
    duration: histogramSchema,
    rate: histogramSchema,
  }),
  metrics: z.array(metricProfileSchema).max(100),
  longest: z.array(referenceSchema).max(3),
});
const peakSchema = z.strictObject({
  from: dateSchema,
  to: dateSchema,
  distanceM: nullable,
  movingS: nullable,
  sessions: count,
  distanceKnown: count,
  movingKnown: count,
});
const benchmarkResultSchema = z.strictObject({ sessions: count, best: referenceSchema.nullable() });
const longitudinalSportSchema = z.strictObject({
  firstDate: dateSchema.nullable(),
  lastDate: dateSchema.nullable(),
  daysSinceLast: nullable,
  periods: z.array(profilePeriodSchema).length(9),
  adjacentComparisons: z
    .array(
      z.strictObject({
        days: z.number(),
        recentFrom: dateSchema,
        recentTo: dateSchema,
        previousFrom: dateSchema,
        previousTo: dateSchema,
        distanceChangePercent: nullable,
        movingChangePercent: nullable,
        sessionChange: z.number().int(),
        recentDistanceKnown: count,
        previousDistanceKnown: count,
        recentMovingKnown: count,
        previousMovingKnown: count,
      }),
    )
    .length(2),
  consistency: z.strictObject({
    from: dateSchema,
    to: dateSchema,
    completeWeeks: z.literal(52),
    recordedWeeks: count,
    weeksAtLeastTwoSessions: count,
    weeksAtLeastThreeSessions: count,
    longestRecordedWeekStreak: count,
    currentRecordedWeekStreak: count,
    weeklySessions: numericProfileSchema,
    weeklyMoving: numericProfileSchema,
    recordingGaps: z
      .array(z.strictObject({ from: dateSchema, to: dateSchema, days: count }))
      .max(5),
    recentBlocks: z
      .array(
        z.strictObject({
          weeks: count,
          from: dateSchema,
          to: dateSchema,
          recordedWeeks: count,
          sessions: count,
        }),
      )
      .length(5),
  }),
  rolling28Peaks: z.strictObject({
    days: z.literal(28),
    distance: z.array(peakSchema).max(3),
    moving: z.array(peakSchema).max(3),
  }),
  recent28DistanceAsPercentOfPeak: nullable,
  seasons: z
    .array(
      z.strictObject({
        year: z.string(),
        partial: z.boolean(),
        volume: volumeSchema,
        sessionDistance: numericProfileSchema,
        sessionMoving: numericProfileSchema,
        longest: z.array(referenceSchema).max(1),
        conditions: z
          .array(
            z.strictObject({ condition: z.string(), sessions: count, pace: numericProfileSchema }),
          )
          .max(8),
      }),
    )
    .max(131),
  endurance: z
    .array(
      z.strictObject({
        minDistanceM: z.number(),
        comparison: z.literal('whole_activity_at_least_distance'),
        lifetimeSessions: count,
        recent90Sessions: count,
        recent365Sessions: count,
        recent90DistinctWeeks: count,
        firstDate: dateSchema.nullable(),
        lastDate: dateSchema.nullable(),
        daysSinceLast: nullable,
        recent90GapDays: numericProfileSchema,
        evidence: z.array(referenceSchema).max(3),
      }),
    )
    .max(8),
  benchmarks: z
    .array(
      z.strictObject({
        targetDistanceM: z.number(),
        toleranceM: z.number(),
        condition: z.string(),
        timeBasis: z.literal('elapsed'),
        allTime: benchmarkResultSchema,
        recent90: benchmarkResultSchema,
        recent365: benchmarkResultSchema,
        recent90VsAllTimeElapsedPercent: nullable,
        seasons: z
          .array(z.strictObject({ year: z.string(), sessions: count, best: referenceSchema }))
          .max(131),
        caveats: z.array(z.string()).max(5),
      }),
    )
    .max(48),
  unknowns: z.array(z.string()).max(20),
});
export const longitudinalSchema = z.strictObject({
  methodology: z.literal('longitudinal-observations-v1'),
  quantiles: z.literal('linear_interpolation_type_7'),
  comparisonPolicy: z.literal('adjacent_non_overlapping_equal_calendar_windows'),
  profiles: z.strictObject({
    run: longitudinalSportSchema,
    bike: longitudinalSportSchema,
    swim: longitudinalSportSchema,
  }),
  multisport: z.strictObject({
    sameDayCount: count,
    combinationCounts: z.record(z.string(), count),
    recentExamples: z
      .array(
        z.strictObject({
          date: dateSchema,
          disciplines: z.array(discipline).max(3),
          activityIds: z.array(z.uuid()).max(6),
          truncated: z.boolean(),
        }),
      )
      .max(10),
    interpretation: z.literal('same_calendar_date_does_not_establish_brick_or_transition'),
  }),
});
export const athleteSnapshotSchema = z.strictObject({
  schemaVersion: z.literal('sportos.athlete-snapshot.v1'),
  calculationVersion: z.literal('canonical-calendar-v2'),
  generatedAt: z.iso.datetime(),
  asOfDate: dateSchema,
  timezone: z.string(),
  completeThrough: dateSchema,
  sourcePolicy: z.strictObject({
    primary: z.literal('canonical_activity_strava_priority'),
    supplement: z.literal('current_allowlisted_provider_metric_projections'),
    deduplication: z.literal('canonical_uuid'),
    narrative: z.literal('excluded'),
    providerReads: z.literal('retained_only'),
  }),
  units: z.strictObject({
    distance: z.literal('m'),
    duration: z.literal('s'),
    heartRate: z.literal('bpm'),
    power: z.literal('W'),
    pace: z.literal('s/km'),
    swimPace: z.literal('s/100m'),
    speed: z.literal('km/h'),
  }),
  coverage: z.strictObject({
    canonicalSessions: count,
    firstDate: dateSchema.nullable(),
    lastDate: dateSchema.nullable(),
    lastCanonicalUpdate: z.iso.datetime().nullable(),
    incompleteDayExcluded: z.boolean(),
    incompleteDaySessions: count,
    archiveCompleteness: z.literal('unknown'),
    providerSyncFreshness: z.literal('connection_metadata_observed_at_generation'),
    providerConnections: z
      .array(
        z.strictObject({
          provider: z.string(),
          status: z.string(),
          lastSyncAt: z.iso.datetime().nullable(),
          lastAttemptAt: z.iso.datetime().nullable(),
        }),
      )
      .max(10),
    projectedMetricSessions: count,
  }),
  longitudinal: longitudinalSchema,
  disciplines: z.strictObject({
    run: disciplineSummary,
    bike: disciplineSummary,
    swim: disciplineSummary,
  }),
  annual: z.array(bucket).max(131),
  monthly: z.array(bucket).max(12),
  completeWeeks: z.array(bucket).length(52),
  runningBests: z.array(runningBest).max(7),
  recentRunningBests: z.array(runningBest).max(7),
  knownUnknowns: z.array(z.string()).max(30),
  limitations: z.array(z.string()).max(30),
});
export type Snapshot = z.infer<typeof athleteSnapshotSchema>;
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(['NOT_FOUND', 'UNAVAILABLE', 'INVALID_INPUT', 'BUSY', 'OUTPUT_LIMIT']),
    message: z.string().max(180),
  }),
});
export const readMetadata = z.strictObject({
  schemaVersion: z.literal('sportos.athlete-read.v1'),
  readAt: z.iso.datetime(),
  timezone: z.string(),
  from: dateSchema,
  to: dateSchema,
  incompleteDayIncluded: z.boolean(),
  freshness: z.literal('retained_only_sync_freshness_unknown'),
});
export const detailOutput = z.strictObject({
  metadata: readMetadata,
  activity: evidenceSchema,
  supplements: z.array(supplement).max(100),
  providerCoverage: z
    .array(
      z.strictObject({
        provider: z.enum(['strava', 'garmin']),
        state: z.string(),
        lastProjectedAt: z.iso.datetime().nullable(),
        missingCount: count,
        rejectedCount: count,
      }),
    )
    .max(2),
  swimLengths: z
    .strictObject({
      status: z.enum(['available', 'unavailable']),
      reason: z.string().optional(),
      poolLengthM: nullable,
      poolLengthDisplay: z.string().nullable(),
      expectedLengths: nullable,
      expectedActiveLengths: nullable,
      complete: z.boolean().nullable(),
      truncated: z.boolean(),
      total: count,
      limit: count,
      offset: count,
      hasMore: z.boolean(),
      canonicalCorrectionApplied: z.literal(false),
      lengths: z
        .array(
          z.strictObject({
            row: count,
            lengthNumber: nullable,
            kind: z.enum(['active', 'rest', 'unknown']),
            durationS: nullable,
            durationBasis: z.enum(['timer', 'elapsed']).nullable(),
            paceSPer100M: nullable,
            strokes: nullable,
            swolf: nullable,
            stroke: z.string().nullable(),
          }),
        )
        .max(100),
    })
    .nullable(),
  laps: z.strictObject({
    limit: count,
    offset: count,
    total: count,
    hasMore: z.boolean(),
    status: z.string(),
    provider: z.enum(['strava', 'garmin']).nullable(),
    items: z
      .array(
        z.strictObject({
          index: count,
          distanceM: nullable,
          elapsedS: nullable,
          movingS: nullable,
          timerS: nullable,
          avgHrBpm: nullable,
        }),
      )
      .max(100),
    truncated: z.boolean(),
  }),
});
const totalsSchema = z.strictObject({
  calendarDays: nullable,
  sessionsPerWeek: nullable,
  sessions: count,
  distanceM: nullable,
  movingS: nullable,
  elapsedS: nullable,
  distanceKnown: count,
  movingKnown: count,
  elapsedKnown: count,
  activeDays: count,
});
export const searchOutput = z.strictObject({
  totals: totalsSchema,
  metadata: readMetadata,
  items: z.array(evidenceSchema).max(100),
  total: count,
  limit: count,
  offset: count,
  coverage: z.strictObject({
    archiveCompleteness: z.literal('unknown'),
    providerReads: z.literal('none'),
  }),
});
export const volumeOutput = z.strictObject({
  totals: totalsSchema,
  metadata: readMetadata,
  buckets: z.array(bucket).max(100),
  total: count,
  limit: count,
  offset: count,
  coverage: z.strictObject({
    archiveCompleteness: z.literal('unknown'),
    emptyBucketMeaning: z.literal('no_retained_sessions'),
  }),
});
export const bestOutput = z.strictObject({
  metadata: readMetadata,
  discipline,
  method: z.enum(['historical_import_or_continuous_effort', 'whole_activity']),
  targetDistanceM: z.number().nullable(),
  toleranceM: nullable,
  total: count,
  limit: count,
  offset: count,
  items: z
    .array(
      z.union([
        evidenceSchema,
        z.strictObject({
          activityId: z.uuid().nullable(),
          eventId: z.uuid().nullable(),
          date: dateSchema,
          durationS: z.number().positive(),
          source: z.string(),
          pausePolicy: z.string(),
          rank: count,
          alternativeCount: count,
          method: z.enum(['historical_import', 'calculated']),
          targetDistanceM: z.number(),
        }),
      ]),
    )
    .max(100),
  coverage: z.record(z.string(), z.union([z.number(), z.string()])),
});
