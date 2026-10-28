import { describe, it, expect } from 'vitest';
import {
  aggregate,
  buildAthleteSnapshot,
  localDate,
  monday,
  shiftDate,
  volumeBuckets,
  type AthleteActivity,
} from './athlete-snapshot.js';
const activity = (
  id: string,
  date = '2026-10-27',
  extra: Partial<AthleteActivity> = {},
): AthleteActivity => ({
  id,
  date,
  discipline: 'run',
  source: 'strava',
  subtype: 'outdoor',
  distanceM: 5000,
  recordedDistanceM: 5000,
  distanceCorrected: false,
  elapsedS: 1800,
  movingS: 1500,
  avgHrBpm: null,
  maxHrBpm: null,
  elevationM: null,
  updatedAt: '2026-10-28T12:00:00.000Z',
  historicalSummary: false,
  ...extra,
});
const build = (activities: AthleteActivity[], extra = {}) =>
  buildAthleteSnapshot({
    activities,
    supplements: [],
    runningBests: [],
    recentRunningBests: [],
    asOfDate: '2026-10-28',
    timezone: 'Europe/Copenhagen',
    generatedAt: '2026-10-28T12:00:00.000Z',
    ...extra,
  });
describe('deterministic athlete snapshot', () => {
  it('uses local dates across UTC midnight, DST and leap boundaries', () => {
    expect(localDate(new Date('2026-10-27T23:30:00Z'), 'Europe/Copenhagen')).toBe('2026-10-28');
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(monday('2026-10-25')).toBe('2026-10-19');
  });
  it('deduplicates canonical UUID and excludes the current incomplete day', () => {
    const a = activity('one');
    const result = build([a, a, activity('two', '2026-10-28')]);
    expect(result.coverage.canonicalSessions).toBe(1);
    expect(result.coverage.incompleteDaySessions).toBe(1);
    expect(result.completeThrough).toBe('2026-10-27');
    expect(result.disciplines.run.windows[0]).toMatchObject({
      from: '2026-10-21',
      to: '2026-10-27',
      sessions: 1,
      distanceM: 5000,
    });
    expect(() => build([a, { ...a, distanceM: 6000 }])).toThrow('Conflicting');
  });
  it('distinguishes complete ISO weeks and inclusive trailing calendar windows', () => {
    const result = build([activity('one', '2026-10-20'), activity('two', '2026-10-21')]);
    expect(result.completeWeeks).toHaveLength(52);
    expect(result.completeWeeks.at(-1)?.disciplines.run.to).toBe('2026-10-25');
    expect(result.disciplines.run.windows[0].sessions).toBe(1);
    const historic = build([], { asOfDate: '2026-10-25' });
    expect(historic.completeThrough).toBe('2026-10-25');
    expect(historic.completeWeeks.at(-1)?.key).toBe('2026-10-19');
  });
  it('separates sums, known counts and paired moving/elapsed pace semantics', () => {
    const rows = [
      activity('a'),
      activity('b', '2026-10-26', { distanceM: 10000, movingS: null, elapsedS: 3600 }),
      activity('c', '2026-10-25', { distanceM: null, movingS: 1000 }),
      activity('d', '2026-10-24', { distanceM: 0, movingS: 0, elapsedS: 0 }),
    ];
    expect(aggregate(rows, '2026-10-01', '2026-10-27')).toMatchObject({
      distanceM: 15000,
      distanceKnown: 3,
      movingS: 2500,
      movingKnown: 3,
      elapsedS: 7200,
      pacePairedSessions: 2,
      paceMovingSessions: 1,
      paceElapsedFallbackSessions: 1,
      weightedPaceSPerKm: 340,
      meanSessionPaceSPerKm: 330,
      medianSessionDistanceM: 5000,
    });
    expect(aggregate([], '2026-10-01', '2026-10-27')).toMatchObject({
      sessions: 0,
      distanceM: null,
      movingS: null,
      elapsedS: null,
      weightedPaceSPerKm: null,
    });
  });
  it('applies effective distance to swim pace and never invents shorter interval records', () => {
    const result = build([
      activity('swim', '2026-10-27', {
        discipline: 'swim',
        distanceM: 1600,
        recordedDistanceM: 2000,
        distanceCorrected: true,
        movingS: 1920,
      }),
    ]);
    expect(result.disciplines.swim.recent[0]).toMatchObject({
      paceSPer100m: 120,
      recordedDistanceM: 2000,
      distanceM: 1600,
    });
    expect(
      result.disciplines.swim.wholeActivityBenchmarks.find((b) => b.targetDistanceM === 1500)
        ?.candidates,
    ).toEqual([]);
  });
  it('keeps summary reconstructions out of whole-activity rankings', () => {
    const result = build([
      activity('estimate', '2026-10-27', {
        discipline: 'bike',
        distanceM: 40000,
        historicalSummary: true,
      }),
    ]);
    expect(result.disciplines.bike.longest[0].method).toBe('summary_estimated');
    expect(result.disciplines.bike.wholeActivityBenchmarks.flatMap((b) => b.candidates)).toEqual(
      [],
    );
  });
  it('generates empty and partial calendar buckets without claiming rest', () => {
    const result = volumeBuckets(
      [activity('one', '2026-10-03')],
      '2026-10-02',
      '2026-10-04',
      'daily',
    );
    expect(result).toHaveLength(3);
    expect(result.map((b) => b.disciplines.run.sessions)).toEqual([0, 1, 0]);
    expect(volumeBuckets([], '2026-10-02', '2026-10-04', 'weekly')[0]).toMatchObject({
      key: '2026-09-28',
      partial: true,
    });
  });
});
