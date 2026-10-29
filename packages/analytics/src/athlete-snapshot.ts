export * from './athlete-observations.js';
import {
  DISCIPLINES,
  SNAPSHOT_VERSION,
  CALCULATION_VERSION,
  WINDOWS,
  mean,
  median,
  positive,
  aggregate,
  activityEvidence,
  localDate,
  monday,
  shiftDate,
  volumeBuckets,
  type AthleteActivity,
  type Supplement,
  type RunBest,
  type Discipline,
} from './athlete-observations.js';
import { buildLongitudinalProfile } from './athlete-longitudinal.js';
export function buildAthleteSnapshot(input: {
  activities: AthleteActivity[];
  supplements: Supplement[];
  runningBests: RunBest[];
  recentRunningBests: RunBest[];
  asOfDate: string;
  timezone: string;
  generatedAt: string;
  windows?: readonly number[];
  providerFreshness?: {
    provider: string;
    status: string;
    lastSyncAt: string | null;
    lastAttemptAt: string | null;
  }[];
}) {
  const { asOfDate, timezone, generatedAt } = input;
  // Identical canonical IDs converge. Conflicting duplicates fail rather than choose.
  const unique = new Map<string, AthleteActivity>();
  for (const a of input.activities) {
    const prior = unique.get(a.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(a))
      throw Error('Conflicting canonical activity.');
    unique.set(a.id, a);
  }
  const all = [...unique.values()]
    .filter((a) => a.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const today = localDate(new Date(generatedAt), timezone),
    completeTo = asOfDate >= today ? shiftDate(today, -1) : asOfDate;
  const rows = all.filter((a) => a.date <= completeTo),
    first = rows[0]?.date ?? completeTo;
  const lastMonday = monday(shiftDate(completeTo, 1)); // Last 52 fully complete Mon–Sun weeks.
  const weekTo = shiftDate(lastMonday, -1),
    weekFrom = shiftDate(lastMonday, -364);
  const monthFrom = shiftDate(
    new Date(Date.UTC(Number(completeTo.slice(0, 4)), Number(completeTo.slice(5, 7)) - 12, 1, 12))
      .toISOString()
      .slice(0, 10),
    0,
  );
  const windows = input.windows ?? WINDOWS;
  const includedIds = new Set(rows.map((a) => a.id));
  const summarize = (s: Discipline) => {
    const items = rows.filter((a) => a.discipline === s),
      byLength = [...items]
        .filter((a) => positive(a.distanceM))
        .sort(
          (a, b) =>
            b.distanceM! - a.distanceM! || b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
        );
    const itemIds = new Set(items.map((a) => a.id));
    const metrics = input.supplements.filter((m) => itemIds.has(m.activityId));
    return {
      lifetime: aggregate(items, first, completeTo),
      windows: windows.map((days) => ({
        days,
        ...aggregate(
          items.filter((a) => a.date >= shiftDate(completeTo, 1 - days)),
          shiftDate(completeTo, 1 - days),
          completeTo,
        ),
      })),
      longest: byLength.slice(0, 15).map(activityEvidence),
      recent: items.slice(-15).reverse().map(activityEvidence),
      recentLongest: byLength
        .filter((a) => a.date >= shiftDate(completeTo, -89))
        .slice(0, 10)
        .map(activityEvidence),
      distanceDistribution: [0, 1000, 5000, 10000, 20000, 50000, 100000, 180000].map(
        (min, i, bounds) => ({
          minM: min,
          maxM: bounds[i + 1] ?? null,
          sessions: items.filter(
            (a) =>
              a.distanceM !== null &&
              a.distanceM >= min &&
              (bounds[i + 1] === undefined || a.distanceM < bounds[i + 1]),
          ).length,
        }),
      ),
      paceDistribution: [0, 180, 240, 300, 360, 480, 600, 1200].map((min, i, bounds) => ({
        minSPerKm: min,
        maxSPerKm: bounds[i + 1] ?? null,
        sessions: items
          .map(activityEvidence)
          .filter(
            (a) =>
              a.paceSPerKm !== null &&
              a.paceSPerKm >= min &&
              (bounds[i + 1] === undefined || a.paceSPerKm < bounds[i + 1]),
          ).length,
      })),
      metrics: [...new Set(metrics.map((m) => m.key))].sort().map((key) => {
        const values = metrics.filter((m) => m.key === key);
        return {
          key,
          unit: values[0].unit,
          sessions: new Set(values.map((m) => m.activityId)).size,
          mean: mean(values.map((m) => m.value)),
          median: median(values.map((m) => m.value)),
          min: Math.min(...values.map((m) => m.value)),
          max: Math.max(...values.map((m) => m.value)),
          evidence: values.slice(-5),
        };
      }),
      wholeActivityBenchmarks: (s === 'bike'
        ? [20000, 40000, 90000, 180000]
        : s === 'swim'
          ? [100, 400, 1000, 1500, 1900, 3800]
          : [5000, 10000, 21097.5, 42195]
      ).map((targetDistanceM) => ({
        targetDistanceM,
        toleranceM: Math.max(1, targetDistanceM * 0.01),
        candidates: items
          .filter(
            (a) =>
              positive(a.distanceM) &&
              Math.abs(a.distanceM - targetDistanceM) <= Math.max(1, targetDistanceM * 0.01) &&
              !a.historicalSummary,
          )
          .map(activityEvidence)
          .filter((a) => a.elapsedS !== null && a.elapsedS > 0)
          .sort(
            (a, b) =>
              a.elapsedS! - b.elapsedS! || a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
          )
          .slice(0, 5),
      })),
    };
  };
  const disciplines = Object.fromEntries(DISCIPLINES.map((s) => [s, summarize(s)])) as Record<
    Discipline,
    ReturnType<typeof summarize>
  >;
  return {
    schemaVersion: SNAPSHOT_VERSION,
    calculationVersion: CALCULATION_VERSION,
    generatedAt,
    asOfDate,
    timezone,
    completeThrough: completeTo,
    sourcePolicy: {
      primary: 'canonical_activity_strava_priority',
      supplement: 'current_allowlisted_provider_metric_projections',
      deduplication: 'canonical_uuid',
      narrative: 'excluded',
      providerReads: 'retained_only',
    },
    units: {
      distance: 'm',
      duration: 's',
      heartRate: 'bpm',
      power: 'W',
      pace: 's/km',
      swimPace: 's/100m',
      speed: 'km/h',
    },
    coverage: {
      canonicalSessions: rows.length,
      firstDate: rows[0]?.date ?? null,
      lastDate: rows.at(-1)?.date ?? null,
      lastCanonicalUpdate: rows.length
        ? rows
            .map((a) => a.updatedAt)
            .sort()
            .at(-1)!
        : null,
      incompleteDayExcluded: asOfDate >= today,
      incompleteDaySessions: all.filter((a) => a.date > completeTo).length,
      archiveCompleteness: 'unknown',
      providerSyncFreshness: 'connection_metadata_observed_at_generation',
      providerConnections: input.providerFreshness ?? [],
      projectedMetricSessions: new Set(
        input.supplements.filter((m) => includedIds.has(m.activityId)).map((m) => m.activityId),
      ).size,
    },
    disciplines,
    longitudinal: buildLongitudinalProfile(rows, input.supplements, completeTo),
    annual: volumeBuckets(rows, first, completeTo, 'annual'),
    monthly: volumeBuckets(
      rows.filter((a) => a.date >= monthFrom),
      monthFrom,
      completeTo,
      'monthly',
    ),
    completeWeeks: volumeBuckets(
      rows.filter((a) => a.date >= weekFrom && a.date <= weekTo),
      weekFrom,
      weekTo,
      'weekly',
    ),
    runningBests: input.runningBests,
    recentRunningBests: input.recentRunningBests,
    knownUnknowns: [
      'FTP, CSS, physiological zones, threshold and VO2max are not established by this snapshot.',
      'Race certification, course, weather, drafting, open-water safety and fueling are not established by activity summaries.',
      'No retained interval evidence is synthesized from average session pace.',
      'Same-day multisport sessions do not establish a brick or transition practice.',
    ],
    limitations: [
      'No provider fetch, synchronization or recomputation performed.',
      'Coverage describes retained records; missing sessions do not establish rest or complete archive processing.',
      'Calendar activity dates preserve source-local dates; timezone labels window and incomplete-day policy, and does not reassign source dates.',
      'Pace uses positive moving seconds, else elapsed fallback, on paired positive distance/time only; moving and elapsed totals remain separate.',
      'Whole-activity benchmark tolerance is 1% (minimum 1 metre); exact recorded distance and elapsed time remain authoritative; no split normalization.',
      'Historical summary reconstructed activities are summary_estimated, excluded from whole-activity benchmark ranking.',
      'Running leaderboards preserve historical imported authority and current stream-calculated continuous efforts; they are separate from whole-activity averages.',
      'Provider indices are observations, not physiological diagnoses or readiness estimates.',
    ],
  };
}
export type AthleteSnapshot = ReturnType<typeof buildAthleteSnapshot>;
