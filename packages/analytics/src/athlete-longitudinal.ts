/** Longitudinal observations, never physiological load, fitness, race forecasts or plans. */
import {
  DISCIPLINES,
  aggregate,
  activityEvidence,
  activityPaceSPerKm,
  monday,
  shiftDate,
  type AthleteActivity,
  type Discipline,
  type Supplement,
} from './athlete-observations.js';
const round = (n: number) => Math.round(n * 1000) / 1000;
export function numericProfile(raw: readonly (number | null)[]) {
  const values = raw
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  const quantile = (p: number) => {
    if (!values.length) return null;
    const index = (values.length - 1) * p,
      lower = Math.floor(index),
      fraction = index - lower;
    return round(
      values[lower] + (values[Math.min(lower + 1, values.length - 1)] - values[lower]) * fraction,
    );
  };
  return {
    known: values.length,
    missing: raw.length - values.length,
    min: values.length ? round(values[0]) : null,
    p10: quantile(0.1),
    p25: quantile(0.25),
    median: quantile(0.5),
    p75: quantile(0.75),
    p90: quantile(0.9),
    max: values.length ? round(values.at(-1)!) : null,
    mean: values.length ? round(values.reduce((s, v) => s + v, 0) / values.length) : null,
  };
}
function histogram(raw: readonly (number | null)[], bounds: readonly number[], unit: string) {
  return {
    unit,
    known: raw.filter((v) => v !== null && Number.isFinite(v)).length,
    missing: raw.filter((v) => v === null || !Number.isFinite(v)).length,
    bins: bounds.map((min, index) => ({
      min,
      max: bounds[index + 1] ?? null,
      sessions: raw.filter(
        (v) =>
          v !== null &&
          Number.isFinite(v) &&
          v >= min &&
          (bounds[index + 1] === undefined || v < bounds[index + 1]),
      ).length,
    })),
  };
}
function reference(a: AthleteActivity) {
  const e = activityEvidence(a);
  return {
    activityId: a.id,
    date: a.date,
    source: a.source,
    subtype: a.subtype,
    distanceM: a.distanceM,
    elapsedS: a.elapsedS,
    movingS: a.movingS,
    paceSPerKm: e.paceSPerKm,
    distanceCorrected: a.distanceCorrected,
    method: e.method,
  };
}
const counters = (values: string[]) =>
  Object.fromEntries(
    [...new Set(values)].sort().map((key) => [key, values.filter((v) => v === key).length]),
  );
const signedPercent = (value: number | null, base: number | null) =>
  value === null || base === null || base === 0 ? null : round((value / base - 1) * 100);
function selectedMetrics(rows: readonly AthleteActivity[], supplements: readonly Supplement[]) {
  const byId = new Map(rows.map((a) => [a.id, a]));
  const metrics = new Map<
    string,
    {
      activityId: string;
      date: string;
      value: number;
      source: string;
      origin: string;
      unit: string;
    }[]
  >();
  const add = (
    key: string,
    value: {
      activityId: string;
      date: string;
      value: number;
      source: string;
      origin: string;
      unit: string;
    },
  ) => {
    const list = metrics.get(key) ?? [];
    list.push(value);
    metrics.set(key, list);
  };
  for (const a of rows)
    if (a.avgHrBpm !== null && a.avgHrBpm > 0)
      add('average_heart_rate', {
        activityId: a.id,
        date: a.date,
        value: a.avgHrBpm,
        source: `canonical:${a.source}`,
        origin: 'canonical_summary',
        unit: 'bpm',
      });
  for (const m of supplements) {
    const a = byId.get(m.activityId);
    if (!a || (m.key === 'average_heart_rate' && a.avgHrBpm !== null)) continue;
    add(m.key, {
      activityId: m.activityId,
      date: a.date,
      value: m.value,
      source: m.provider,
      origin: m.origin,
      unit: m.unit,
    });
  }
  return [...metrics]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => ({
      key,
      unit: values[0].unit,
      sessions: new Set(values.map((v) => v.activityId)).size,
      stats: numericProfile(values.map((v) => v.value)),
      sourceCounts: counters(values.map((v) => v.source)),
      originCounts: counters(values.map((v) => v.origin)),
      firstDate: values.map((v) => v.date).sort()[0],
      lastDate: values
        .map((v) => v.date)
        .sort()
        .at(-1)!,
      evidence: [...values]
        .sort((a, b) => b.date.localeCompare(a.date) || a.activityId.localeCompare(b.activityId))
        .slice(0, 2),
    }));
}
const distanceBounds: Record<Discipline, number[]> = {
  run: [0, 3000, 5000, 10000, 15000, 21097.5, 30000, 42195],
  bike: [0, 10000, 20000, 40000, 60000, 90000, 120000, 180000],
  swim: [0, 400, 1000, 1500, 1900, 2500, 3000, 3800],
};
function periodProfile(
  rows: AthleteActivity[],
  supplements: Supplement[],
  sport: Discipline,
  from: string,
  to: string,
  key: string,
) {
  const items = rows.filter((a) => a.date >= from && a.date <= to),
    paces = items.map(activityPaceSPerKm),
    rates = paces.map((p) =>
      p === null ? null : sport === 'bike' ? 3600 / p : sport === 'swim' ? p / 10 : p,
    );
  const paceBounds =
    sport === 'bike'
      ? [0, 10, 15, 20, 25, 30, 35, 40]
      : sport === 'swim'
        ? [0, 60, 90, 120, 150, 180, 240, 300]
        : [0, 180, 240, 300, 360, 420, 480, 600];
  return {
    key,
    evidenceId: `period:${sport}:${from}:${to}`,
    volume: aggregate(items, from, to),
    sessionDistance: numericProfile(items.map((a) => a.distanceM)),
    sessionMoving: numericProfile(items.map((a) => a.movingS)),
    sessionElapsed: numericProfile(items.map((a) => a.elapsedS)),
    sessionRate: numericProfile(rates),
    rateUnit: sport === 'bike' ? 'km/h' : sport === 'swim' ? 's/100m' : 's/km',
    distributions: {
      distance: histogram(
        items.map((a) => a.distanceM),
        distanceBounds[sport],
        'm',
      ),
      duration: histogram(
        items.map((a) => a.movingS),
        [0, 900, 1800, 2700, 3600, 5400, 7200, 10800, 14400],
        's',
      ),
      rate: histogram(
        rates,
        paceBounds,
        sport === 'bike' ? 'km/h' : sport === 'swim' ? 's/100m' : 's/km',
      ),
    },
    metrics: selectedMetrics(items, supplements),
    longest: [...items]
      .filter((a) => a.distanceM !== null && a.distanceM > 0)
      .sort((a, b) => b.distanceM! - a.distanceM! || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map(reference),
  };
}
function rollingPeaks(rows: AthleteActivity[], from: string, to: string) {
  if (!rows.length || shiftDate(from, 27) > to) return { days: 28, distance: [], moving: [] };
  const ordered = [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  let left = 0,
    right = 0,
    distance = 0,
    moving = 0,
    knownDistance = 0,
    knownMoving = 0;
  const candidates: {
    from: string;
    to: string;
    distanceM: number | null;
    movingS: number | null;
    sessions: number;
    distanceKnown: number;
    movingKnown: number;
  }[] = [];
  const change = (a: AthleteActivity, sign: number) => {
    if (a.distanceM !== null) {
      distance += sign * a.distanceM;
      knownDistance += sign;
    }
    if (a.movingS !== null) {
      moving += sign * a.movingS;
      knownMoving += sign;
    }
  };
  for (let end = shiftDate(from, 27); end <= to; end = shiftDate(end, 1)) {
    const start = shiftDate(end, -27);
    while (right < ordered.length && ordered[right].date <= end) change(ordered[right++], 1);
    while (left < right && ordered[left].date < start) change(ordered[left++], -1);
    candidates.push({
      from: start,
      to: end,
      distanceM: knownDistance ? round(distance) : null,
      movingS: knownMoving ? round(moving) : null,
      sessions: right - left,
      distanceKnown: knownDistance,
      movingKnown: knownMoving,
    });
  }
  const select = (metric: 'distanceM' | 'movingS') => {
    const result: typeof candidates = [];
    for (const candidate of [...candidates]
      .filter((c) => c[metric] !== null && c[metric]! > 0)
      .sort((a, b) => b[metric]! - a[metric]! || a.from.localeCompare(b.from))) {
      if (result.some((r) => candidate.from <= r.to && candidate.to >= r.from)) continue;
      result.push(candidate);
      if (result.length === 3) break;
    }
    return result;
  };
  return { days: 28, distance: select('distanceM'), moving: select('movingS') };
}
function consistency(rows: AthleteActivity[], to: string) {
  const until = shiftDate(monday(shiftDate(to, 1)), -1),
    from = shiftDate(until, -363),
    weekMap = new Map<string, AthleteActivity[]>();
  for (const a of rows.filter((a) => a.date >= from && a.date <= until)) {
    const key = monday(a.date),
      list = weekMap.get(key) ?? [];
    list.push(a);
    weekMap.set(key, list);
  }
  const weeks = Array.from({ length: 52 }, (_, i) => {
    const key = shiftDate(from, 7 * i);
    return { ...aggregate(weekMap.get(key) ?? [], key, shiftDate(key, 6)) };
  });
  let streak = 0,
    longest = 0;
  for (const w of weeks) {
    streak = w.sessions ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const activeDates = [
    ...new Set(rows.filter((a) => a.date >= from && a.date <= until).map((a) => a.date)),
  ].sort();
  const boundaries = [shiftDate(from, -1), ...activeDates, shiftDate(until, 1)];
  const gaps = boundaries
    .slice(1)
    .map((next, i) => ({
      from: shiftDate(boundaries[i], 1),
      to: shiftDate(next, -1),
      days: Math.round((Date.parse(next) - Date.parse(boundaries[i])) / 86400000) - 1,
    }))
    .filter((g) => g.days > 0)
    .sort((a, b) => b.days - a.days || a.from.localeCompare(b.from))
    .slice(0, 5);
  return {
    from,
    to: until,
    completeWeeks: 52,
    recordedWeeks: weeks.filter((w) => w.sessions > 0).length,
    weeksAtLeastTwoSessions: weeks.filter((w) => w.sessions >= 2).length,
    weeksAtLeastThreeSessions: weeks.filter((w) => w.sessions >= 3).length,
    longestRecordedWeekStreak: longest,
    currentRecordedWeekStreak: streak,
    weeklySessions: numericProfile(weeks.map((w) => w.sessions)),
    weeklyMoving: numericProfile(weeks.map((w) => w.movingS)),
    recordingGaps: gaps,
    recentBlocks: [4, 8, 13, 26, 52].map((count) => ({
      weeks: count,
      from: weeks[52 - count].from,
      to: until,
      recordedWeeks: weeks.slice(-count).filter((w) => w.sessions > 0).length,
      sessions: weeks.slice(-count).reduce((s, w) => s + w.sessions, 0),
    })),
  };
}
const enduranceTargets: Record<Discipline, number[]> = {
  run: [5000, 10000, 15000, 21097.5, 25000, 30000, 42195],
  bike: [20000, 40000, 60000, 90000, 120000, 150000, 180000],
  swim: [400, 1000, 1500, 1900, 3000, 3800],
};
function endurance(rows: AthleteActivity[], sport: Discipline, to: string) {
  return enduranceTargets[sport].map((minDistanceM) => {
    const selected = rows
        .filter((a) => !a.historicalSummary && a.distanceM !== null && a.distanceM >= minDistanceM)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
      recent = selected.filter((a) => a.date >= shiftDate(to, -89)),
      year = selected.filter((a) => a.date >= shiftDate(to, -364)),
      dates = [...new Set(recent.map((a) => a.date))].sort();
    return {
      minDistanceM,
      comparison: 'whole_activity_at_least_distance' as const,
      lifetimeSessions: selected.length,
      recent90Sessions: recent.length,
      recent365Sessions: year.length,
      recent90DistinctWeeks: new Set(recent.map((a) => monday(a.date))).size,
      firstDate: selected[0]?.date ?? null,
      lastDate: selected.at(-1)?.date ?? null,
      daysSinceLast: selected.length
        ? Math.round((Date.parse(to) - Date.parse(selected.at(-1)!.date)) / 86400000)
        : null,
      recent90GapDays: numericProfile(
        dates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 86400000),
      ),
      evidence: selected.slice(-3).reverse().map(reference),
    };
  });
}
function benchmarks(rows: AthleteActivity[], sport: Discipline, to: string) {
  if (sport === 'run') return [];
  const targets =
    sport === 'bike' ? [20000, 40000, 90000, 180000] : [100, 400, 1000, 1500, 1900, 3800];
  return targets.flatMap((targetDistanceM) => {
    const toleranceM = Math.max(1, targetDistanceM * 0.01),
      eligible = rows.filter(
        (a) =>
          !a.historicalSummary &&
          a.distanceM !== null &&
          Math.abs(a.distanceM - targetDistanceM) <= toleranceM &&
          a.elapsedS !== null &&
          a.elapsedS > 0,
      );
    const conditions = [...new Set(eligible.map((a) => a.subtype ?? 'unknown'))].sort();
    // Include an explicit empty category when no matching whole activity exists.
    return (conditions.length ? conditions : ['unknown']).map((condition) => {
      const matching = eligible.filter((a) => (a.subtype ?? 'unknown') === condition),
        rank = (items: AthleteActivity[]) =>
          [...items].sort(
            (a, b) =>
              a.elapsedS! - b.elapsedS! || a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
          );
      const historic = rank(matching),
        recent = rank(matching.filter((a) => a.date >= shiftDate(to, -89))),
        annual = rank(matching.filter((a) => a.date >= shiftDate(to, -364)));
      return {
        targetDistanceM,
        toleranceM,
        condition,
        timeBasis: 'elapsed' as const,
        allTime: { sessions: historic.length, best: historic[0] ? reference(historic[0]) : null },
        recent90: { sessions: recent.length, best: recent[0] ? reference(recent[0]) : null },
        recent365: { sessions: annual.length, best: annual[0] ? reference(annual[0]) : null },
        recent90VsAllTimeElapsedPercent: signedPercent(
          recent[0]?.elapsedS ?? null,
          historic[0]?.elapsedS ?? null,
        ),
        seasons: [...new Set(matching.map((a) => a.date.slice(0, 4)))].sort().map((year) => {
          const candidates = rank(matching.filter((a) => a.date.startsWith(year)));
          return { year, sessions: candidates.length, best: reference(candidates[0]) };
        }),
        caveats: [
          'whole_activity_not_interval',
          'distance_band_not_normalized',
          'same_subtype_does_not_prove_same_course_or_conditions',
        ],
      };
    });
  });
}
export function buildLongitudinalProfile(
  rows: AthleteActivity[],
  supplements: Supplement[],
  to: string,
) {
  const globalFrom = rows[0]?.date ?? to;
  const summarize = (sport: Discipline) => {
    const items = rows.filter((a) => a.discipline === sport),
      itemIds = new Set(rows.filter((a) => a.discipline === sport).map((a) => a.id)),
      first = items[0]?.date ?? null,
      last = items.at(-1)?.date ?? null;
    const periods = [
      periodProfile(items, supplements, sport, globalFrom, to, 'lifetime'),
      ...[7, 28, 30, 90, 180, 365].map((days) =>
        periodProfile(items, supplements, sport, shiftDate(to, 1 - days), to, `recent_${days}`),
      ),
      ...[28, 90].map((days) =>
        periodProfile(
          items,
          supplements,
          sport,
          shiftDate(to, 1 - 2 * days),
          shiftDate(to, -days),
          `previous_${days}`,
        ),
      ),
    ];
    const peaks = rollingPeaks(items, first ?? to, to),
      current = periods.find((p) => p.key === 'recent_28')!.volume;
    const comparison = [28, 90].map((days) => {
      const recent = periods.find((p) => p.key === `recent_${days}`)!.volume,
        previous = periods.find((p) => p.key === `previous_${days}`)!.volume;
      return {
        days,
        recentFrom: recent.from,
        recentTo: recent.to,
        previousFrom: previous.from,
        previousTo: previous.to,
        distanceChangePercent: signedPercent(recent.distanceM, previous.distanceM),
        movingChangePercent: signedPercent(recent.movingS, previous.movingS),
        sessionChange: recent.sessions - previous.sessions,
        recentDistanceKnown: recent.distanceKnown,
        previousDistanceKnown: previous.distanceKnown,
        recentMovingKnown: recent.movingKnown,
        previousMovingKnown: previous.movingKnown,
      };
    });
    return {
      firstDate: first,
      lastDate: last,
      daysSinceLast: last ? Math.round((Date.parse(to) - Date.parse(last)) / 86400000) : null,
      periods,
      adjacentComparisons: comparison,
      consistency: consistency(items, to),
      rolling28Peaks: peaks,
      recent28DistanceAsPercentOfPeak:
        current.distanceM !== null && peaks.distance[0]?.distanceM
          ? round((current.distanceM / peaks.distance[0].distanceM) * 100)
          : null,
      seasons: [...new Set(items.map((a) => a.date.slice(0, 4)))].sort().map((year) => {
        const selected = items.filter((a) => a.date.startsWith(year)),
          yearFrom = year + '-01-01',
          yearTo = year + '-12-31';
        return {
          year,
          partial: yearFrom < globalFrom || yearTo > to,
          volume: aggregate(
            selected,
            yearFrom < globalFrom ? globalFrom : yearFrom,
            yearTo > to ? to : yearTo,
          ),
          sessionDistance: numericProfile(selected.map((a) => a.distanceM)),
          sessionMoving: numericProfile(selected.map((a) => a.movingS)),
          longest: [...selected]
            .filter((a) => a.distanceM !== null)
            .sort((a, b) => b.distanceM! - a.distanceM! || a.id.localeCompare(b.id))
            .slice(0, 1)
            .map(reference),
          conditions: [...new Set(selected.map((a) => a.subtype ?? 'unknown'))]
            .sort()
            .map((condition) => {
              const group = selected.filter((a) => (a.subtype ?? 'unknown') === condition);
              return {
                condition,
                sessions: group.length,
                pace: numericProfile(group.map(activityPaceSPerKm)),
              };
            }),
        };
      }),
      endurance: endurance(items, sport, to),
      benchmarks: benchmarks(items, sport, to),
      unknowns: [
        ...(items.every((a) => a.avgHrBpm === null) &&
        !supplements.some((m) => m.key === 'average_heart_rate' && itemIds.has(m.activityId))
          ? ['heart_rate_not_retained']
          : []),
        ...(sport === 'bike'
          ? ['ftp_not_established', 'power_sensor_verification_not_available']
          : []),
        ...(sport === 'swim'
          ? ['css_not_established', 'open_water_conditions_not_established']
          : []),
        ...['recovery_not_established', 'physiological_zones_not_established'],
      ],
    };
  };
  const profiles = Object.fromEntries(
    DISCIPLINES.map((sport) => [sport, summarize(sport)]),
  ) as Record<Discipline, ReturnType<typeof summarize>>;
  const dayMap = new Map<string, AthleteActivity[]>();
  for (const a of rows) {
    const list = dayMap.get(a.date) ?? [];
    list.push(a);
    dayMap.set(a.date, list);
  }
  const multisport = [...dayMap]
    .filter(([, list]) => new Set(list.map((a) => a.discipline)).size > 1)
    .sort(([a], [b]) => b.localeCompare(a));
  return {
    methodology: 'longitudinal-observations-v1' as const,
    quantiles: 'linear_interpolation_type_7' as const,
    comparisonPolicy: 'adjacent_non_overlapping_equal_calendar_windows' as const,
    profiles,
    multisport: {
      sameDayCount: multisport.length,
      combinationCounts: counters(
        multisport.map(([, list]) => [...new Set(list.map((a) => a.discipline))].sort().join('+')),
      ),
      recentExamples: multisport
        .slice(0, 10)
        .map(([date, list]) => ({
          date,
          disciplines: [...new Set(list.map((a) => a.discipline))].sort(),
          activityIds: list.slice(0, 6).map((a) => a.id),
          truncated: list.length > 6,
        })),
      interpretation: 'same_calendar_date_does_not_establish_brick_or_transition' as const,
    },
  };
}
