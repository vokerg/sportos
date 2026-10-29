import { describe, it, expect } from 'vitest';
import { buildLongitudinalProfile, numericProfile } from './athlete-longitudinal.js';
import { buildAthleteSnapshot, type AthleteActivity, type Supplement } from './athlete-snapshot.js';
const a = (
  id: string,
  date: string,
  distanceM = 5000,
  extra: Partial<AthleteActivity> = {},
): AthleteActivity => ({
  id,
  date,
  distanceM,
  recordedDistanceM: distanceM,
  distanceCorrected: false,
  discipline: 'run',
  source: 'strava',
  subtype: 'outdoor',
  elapsedS: 1800,
  movingS: 1500,
  avgHrBpm: null,
  maxHrBpm: null,
  elevationM: null,
  updatedAt: '2026-10-29T12:00:00.000Z',
  historicalSummary: false,
  ...extra,
});
const profile = (rows: AthleteActivity[], supplements: Supplement[] = []) =>
  buildLongitudinalProfile(rows, supplements, '2026-10-28');
describe('substantive longitudinal athlete evidence', () => {
  it('uses type-7 quantiles and preserves missing values separately from zero', () => {
    expect(numericProfile([0, 10, 20, 30, null])).toMatchObject({
      known: 4,
      missing: 1,
      median: 15,
      p25: 7.5,
      p75: 22.5,
      p90: 27,
      mean: 15,
    });
    expect(numericProfile([null])).toMatchObject({ known: 0, median: null, min: null });
  });
  it('compares adjacent equal nonoverlapping windows and selects metrics by activity date', () => {
    const rows = [a('old', '2026-09-10', 10000), a('new', '2026-10-20', 20000)];
    const m: Supplement = {
      activityId: 'old',
      provider: 'garmin',
      key: 'average_power',
      value: 220,
      unit: 'W',
      origin: 'provider_derived',
      sourceKind: 'fit_session',
      method: 'calculated',
      projectedAt: '2026-10-28T12:00:00.000Z',
    };
    const d = profile(rows, [m]).profiles.run,
      c = d.adjacentComparisons.find((c) => c.days === 28)!;
    expect(c).toMatchObject({
      recentFrom: '2026-10-01',
      recentTo: '2026-10-28',
      previousFrom: '2026-09-03',
      previousTo: '2026-09-30',
      distanceChangePercent: 100,
      sessionChange: 0,
    });
    expect(d.periods.find((v) => v.key === 'recent_28')!.metrics).toEqual([]);
    expect(d.periods.find((v) => v.key === 'previous_28')!.metrics[0]).toMatchObject({
      key: 'average_power',
      sessions: 1,
      originCounts: { provider_derived: 1 },
    });
  });
  it('keeps conditions separate and does not manufacture a 1500m split from 1600m', () => {
    const d = profile([
      a('indoor', '2025-05-01', 1500, { discipline: 'swim', subtype: 'indoor', elapsedS: 1500 }),
      a('outdoor', '2026-10-20', 1500, { discipline: 'swim', subtype: 'outdoor', elapsedS: 1300 }),
      a('longer', '2026-10-21', 1600, { discipline: 'swim', subtype: 'indoor', elapsedS: 1200 }),
    ]).profiles.swim;
    expect(
      d.benchmarks.find((b) => b.targetDistanceM === 1500 && b.condition === 'indoor')?.allTime.best
        ?.activityId,
    ).toBe('indoor');
    expect(
      d.benchmarks.find((b) => b.targetDistanceM === 1500 && b.condition === 'indoor')?.recent90
        .sessions,
    ).toBe(0);
    expect(
      d.benchmarks.find((b) => b.targetDistanceM === 1500 && b.condition === 'outdoor')?.recent90
        .best?.activityId,
    ).toBe('outdoor');
    expect(d.endurance.find((e) => e.minDistanceM === 1500)).toMatchObject({
      lifetimeSessions: 3,
      recent90Sessions: 2,
    });
  });
  it('measures repeatability in distinct weeks and excludes reconstructed summaries', () => {
    const d = profile([
      a('a', '2026-10-01', 30000),
      a('b', '2026-10-02', 30000),
      a('c', '2026-10-15', 30000),
      a('estimate', '2026-10-20', 42195, { historicalSummary: true }),
    ]).profiles.run;
    expect(d.endurance.find((v) => v.minDistanceM === 30000)).toMatchObject({
      lifetimeSessions: 3,
      recent90DistinctWeeks: 2,
      lastDate: '2026-10-15',
      daysSinceLast: 13,
    });
    expect(d.endurance.find((v) => v.minDistanceM === 42195)?.lifetimeSessions).toBe(0);
  });
  it('reports actual gaps and complete-week consistency without inferring rest', () => {
    const c = profile([
      a('a', '2026-10-05'),
      a('b', '2026-10-12'),
      a('c', '2026-10-19'),
      a('partial', '2026-10-28'),
    ]).profiles.run.consistency;
    expect(c).toMatchObject({
      to: '2026-10-25',
      recordedWeeks: 3,
      longestRecordedWeekStreak: 3,
      currentRecordedWeekStreak: 3,
    });
    expect(c.weeklySessions.known).toBe(52);
    expect(c.weeklyMoving.missing).toBe(49);
  });
  it('finds historical rolling peaks using full windows, known counts and deterministic nonoverlap', () => {
    const d = profile([
      a('start', '2025-01-01', 1000),
      a('peak1', '2025-01-15', 20000),
      a('peak2', '2026-10-01', 10000),
      a('peak3', '2026-10-20', 10000),
    ]).profiles.run;
    expect(d.rolling28Peaks.distance[0]).toMatchObject({
      from: '2025-01-01',
      to: '2025-01-28',
      distanceM: 21000,
      sessions: 2,
    });
    expect(d.recent28DistanceAsPercentOfPeak).toBe(95.238);
    const p = d.rolling28Peaks.distance;
    for (let i = 1; i < p.length; i++)
      expect(p[i].from > p[i - 1].to || p[i].to < p[i - 1].from).toBe(true);
  });
  it('uses canonical HR once and separates sport-specific rate units', () => {
    const rows = [
      a('r', '2026-10-20', 5000, { avgHrBpm: 150 }),
      a('b', '2026-10-20', 20000, { discipline: 'bike', movingS: 3600 }),
      a('s', '2026-10-20', 1500, { discipline: 'swim', movingS: 1800 }),
    ];
    const hr: Supplement = {
      activityId: 'r',
      provider: 'garmin',
      key: 'average_heart_rate',
      value: 160,
      unit: 'bpm',
      origin: 'recorded',
      method: 'measured',
      sourceKind: 'fit_session',
      projectedAt: '2026-10-28T12:00:00.000Z',
    };
    const result = profile(rows, [hr]);
    expect(result.profiles.run.periods[0].metrics[0]).toMatchObject({
      sessions: 1,
      stats: { mean: 150 },
    });
    expect(result.profiles.bike.periods[0]).toMatchObject({
      rateUnit: 'km/h',
      sessionRate: { median: 20 },
    });
    expect(result.profiles.swim.periods[0]).toMatchObject({
      rateUnit: 's/100m',
      sessionRate: { median: 120 },
    });
    expect(result.multisport).toMatchObject({
      sameDayCount: 1,
      combinationCounts: { 'bike+run+swim': 1 },
      interpretation: 'same_calendar_date_does_not_establish_brick_or_transition',
    });
  });
  it('shares calculations with snapshots after canonical deduplication', () => {
    const row = a('one', '2026-10-20');
    const result = buildAthleteSnapshot({
      activities: [row, row],
      supplements: [],
      runningBests: [],
      recentRunningBests: [],
      asOfDate: '2026-10-29',
      timezone: 'Europe/Copenhagen',
      generatedAt: '2026-10-29T12:00:00.000Z',
    });
    expect(result.longitudinal.profiles.run.periods[0].volume.sessions).toBe(1);
    expect(result.calculationVersion).toBe('canonical-calendar-v2');
  });
});
