/** Pure, deterministic athlete observations. No database, providers, scoring or forecasts. */
export const DISCIPLINES = ['run', 'bike', 'swim'] as const;
export type Discipline = (typeof DISCIPLINES)[number];
export const SNAPSHOT_VERSION = 'sportos.athlete-snapshot.v1' as const;
export const CALCULATION_VERSION = 'canonical-calendar-v2' as const;
export const WINDOWS = [7, 28, 30, 90, 180, 365] as const;
export interface AthleteActivity {
  id: string;
  date: string;
  discipline: Discipline;
  subtype: string | null;
  source: string;
  distanceM: number | null;
  recordedDistanceM: number | null;
  distanceCorrected: boolean;
  elapsedS: number | null;
  movingS: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  elevationM: number | null;
  updatedAt: string;
  historicalSummary: boolean;
}
export interface Supplement {
  activityId: string;
  provider: 'strava' | 'garmin';
  key: string;
  value: number;
  unit: string;
  origin: string;
  sourceKind: string;
  method: 'measured' | 'calculated';
  projectedAt: string;
}
export interface RunBest {
  targetDistanceM: number;
  total: number;
  coverage: Record<string, number>;
  rows: {
    activityId: string | null;
    eventId: string | null;
    date: string;
    durationS: number;
    source: string;
    pausePolicy: string;
    rank: number;
    alternativeCount: number;
    method: 'historical_import' | 'calculated';
  }[];
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function monday(date: string): string {
  return shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const round = (n: number) => Math.round(n * 1000) / 1000;
export const mean = (v: number[]) =>
  v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null;
export const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length
    ? round((s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2)
    : null;
};
export const positive = (v: number | null): v is number =>
  v !== null && Number.isFinite(v) && v > 0;
export function activityPaceSPerKm(a: AthleteActivity): number | null {
  const durationS = positive(a.movingS) ? a.movingS : positive(a.elapsedS) ? a.elapsedS : null;
  return durationS !== null && positive(a.distanceM) ? durationS / (a.distanceM / 1000) : null;
}
export function activityEvidence(a: AthleteActivity) {
  const pace = activityPaceSPerKm(a);
  return {
    ...a,
    method: a.historicalSummary ? ('summary_estimated' as const) : ('measured' as const),
    evidenceType: 'whole_activity' as const,
    durationBasis: positive(a.movingS)
      ? 'moving'
      : positive(a.elapsedS)
        ? 'elapsed_fallback'
        : 'unavailable',
    paceSPerKm: pace === null ? null : round(pace),
    paceSPer100m: a.discipline === 'swim' && pace !== null ? round(pace / 10) : null,
    speedKmh: pace !== null && pace > 0 ? round(3600 / pace) : null,
    caveats: [
      ...(a.distanceCorrected ? ['manual_distance_correction'] : []),
      ...(a.historicalSummary ? ['historical_summary_not_interval_evidence'] : []),
      ...(!positive(a.movingS) ? ['moving_time_unavailable'] : []),
      ...(a.subtype === null || a.subtype === 'unknown' ? ['conditions_unknown'] : []),
    ],
  };
}
export type ActivityEvidence = ReturnType<typeof activityEvidence>;
export function aggregate(rows: readonly AthleteActivity[], from: string, to: string) {
  const distance = rows.filter((a) => a.distanceM !== null && a.distanceM >= 0);
  const moving = rows.filter((a) => a.movingS !== null && a.movingS >= 0);
  const elapsed = rows.filter((a) => a.elapsedS !== null && a.elapsedS >= 0);
  const paired = rows.filter(
    (a) => positive(a.distanceM) && (positive(a.movingS) || positive(a.elapsedS)),
  );
  const paces = paired.map(
    (a) => (positive(a.movingS) ? a.movingS : a.elapsedS!) / (a.distanceM! / 1000),
  );
  const pairedDistance = paired.reduce((s, a) => s + a.distanceM!, 0);
  const pairedTime = paired.reduce(
    (s, a) => s + (positive(a.movingS) ? a.movingS : a.elapsedS!),
    0,
  );
  const activeDays = new Set(rows.map((a) => a.date)).size;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const total = (items: readonly AthleteActivity[], field: 'distanceM' | 'movingS' | 'elapsedS') =>
    items.length ? round(items.reduce((s, a) => s + a[field]!, 0)) : null;
  return {
    from,
    to,
    calendarDays: days,
    sessions: rows.length,
    activeDays,
    sessionsPerWeek: round((rows.length * 7) / days),
    distanceM: total(distance, 'distanceM'),
    movingS: total(moving, 'movingS'),
    elapsedS: total(elapsed, 'elapsedS'),
    distanceKnown: distance.length,
    movingKnown: moving.length,
    elapsedKnown: elapsed.length,
    averageSessionMovingS: mean(moving.map((a) => a.movingS!)),
    medianSessionMovingS: median(moving.map((a) => a.movingS!)),
    averageSessionDistanceM: mean(distance.map((a) => a.distanceM!)),
    medianSessionDistanceM: median(distance.map((a) => a.distanceM!)),
    meanSessionPaceSPerKm: mean(paces),
    medianSessionPaceSPerKm: median(paces),
    weightedPaceSPerKm: pairedDistance > 0 ? round(pairedTime / (pairedDistance / 1000)) : null,
    pacePairedSessions: paired.length,
    paceMovingSessions: paired.filter((a) => positive(a.movingS)).length,
    paceElapsedFallbackSessions: paired.filter((a) => !positive(a.movingS)).length,
    meanRecordedHrBpm: mean(rows.map((a) => a.avgHrBpm).filter(positive)),
    hrKnown: rows.filter((a) => positive(a.avgHrBpm)).length,
    elevationM: rows.some((a) => a.elevationM !== null)
      ? round(rows.reduce((s, a) => s + (a.elevationM ?? 0), 0))
      : null,
    elevationKnown: rows.filter((a) => a.elevationM !== null).length,
    sourceCounts: Object.fromEntries(
      [...new Set(rows.map((a) => a.source))]
        .sort()
        .map((source) => [source, rows.filter((a) => a.source === source).length]),
    ),
    subtypeCounts: Object.fromEntries(
      [...new Set(rows.map((a) => a.subtype ?? 'unknown'))]
        .sort()
        .map((subtype) => [
          subtype,
          rows.filter((a) => (a.subtype ?? 'unknown') === subtype).length,
        ]),
    ),
    correctedSessions: rows.filter((a) => a.distanceCorrected).length,
    historicalSummarySessions: rows.filter((a) => a.historicalSummary).length,
  };
}
export type Volume = ReturnType<typeof aggregate>;
export function volumeBuckets(
  rows: readonly AthleteActivity[],
  from: string,
  to: string,
  period: 'daily' | 'weekly' | 'monthly' | 'annual',
) {
  const groups = new Map<string, AthleteActivity[]>();
  for (const a of rows) {
    if (a.date < from || a.date > to) continue;
    const key =
      period === 'daily'
        ? a.date
        : period === 'weekly'
          ? monday(a.date)
          : period === 'monthly'
            ? a.date.slice(0, 7) + '-01'
            : a.date.slice(0, 4) + '-01-01';
    const group = groups.get(key) ?? [];
    group.push(a);
    groups.set(key, group);
  }
  return calendarBucketRanges(from, to, period).map((range) => ({
    key: range.key,
    partial: range.partial,
    disciplines: Object.fromEntries(
      DISCIPLINES.map((s) => [
        s,
        aggregate(
          (groups.get(range.key) ?? []).filter((a) => a.discipline === s),
          range.from,
          range.to,
        ),
      ]),
    ) as Record<Discipline, Volume>,
  }));
}
export function calendarBucketRanges(
  from: string,
  to: string,
  period: 'daily' | 'weekly' | 'monthly' | 'annual',
) {
  const keys = new Set<string>();
  for (let date = from; date <= to; date = shiftDate(date, 1))
    keys.add(
      period === 'daily'
        ? date
        : period === 'weekly'
          ? monday(date)
          : period === 'monthly'
            ? date.slice(0, 7) + '-01'
            : date.slice(0, 4) + '-01-01',
    );
  return [...keys].sort().map((key) => {
    const end =
      period === 'daily'
        ? key
        : period === 'weekly'
          ? shiftDate(key, 6)
          : period === 'annual'
            ? key.slice(0, 4) + '-12-31'
            : shiftDate(
                new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1, 12))
                  .toISOString()
                  .slice(0, 10),
                -1,
              );
    const start = key < from ? from : key,
      stop = end > to ? to : end;
    return {
      key,
      from: start,
      to: stop,
      partial: start !== key || stop !== end,
    };
  });
}
