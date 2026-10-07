import { describe, expect, it } from 'vitest';
import { matchGarminActivity, type ActivityMatchSummary } from './activity-matching.js';
const run: ActivityMatchSummary = { activityType: 'run', subtype: 'outdoor', startTime: new Date('2026-10-25T02:30:00+02:00'), elapsedTimeS: 1800, movingTimeS: 1750, distanceM: 5000 };
const candidate = (changes = {}) => ({ ...run, id: 'canonical', ...changes });
describe('Garmin matching policy v1', () => {
  it('links an exact observation and tolerates compact Strava distance correction', () => {
    expect(matchGarminActivity(run, [candidate()]).status).toBe('exact');
    expect(matchGarminActivity(run, [candidate({ distanceM: 5200, elapsedTimeS: 1810 })])).toMatchObject({ status: 'strong_unique', activityId: 'canonical' });
  });
  it('compares instants across time zones, DST and midnight rather than local dates', () => {
    expect(matchGarminActivity(run, [candidate({ startTime: new Date('2026-10-25T00:30:00Z') })]).status).toBe('exact');
    expect(matchGarminActivity(run, [candidate({ startTime: new Date('2026-10-25T02:30:00+01:00') })]).status).toBe('unmatched');
  });
  it('requires uniqueness even against weaker nearby workouts', () => {
    expect(matchGarminActivity(run, [candidate(), candidate({ id: 'second', startTime: new Date(run.startTime.getTime() + 60000) })])).toMatchObject({ status: 'ambiguous', activityId: null });
  });
  it('stages a unique weak match, incompatible metrics, and subtype/type conflicts', () => {
    expect(matchGarminActivity(run, [candidate({ elapsedTimeS: 2400 })]).status).toBe('ambiguous');
    expect(matchGarminActivity(run, [candidate({ distanceM: 6500 })]).status).toBe('ambiguous');
    expect(matchGarminActivity(run, [candidate({ subtype: 'treadmill' })]).status).toBe('unmatched');
    expect(matchGarminActivity(run, [candidate({ activityType: 'bike' })]).status).toBe('unmatched');
  });
  it('supports indoor no-GPS durations but never infers a match from missing metrics', () => {
    const indoor = { ...run, subtype: 'treadmill' as const, distanceM: null };
    expect(matchGarminActivity(indoor, [{ ...indoor, id: 'indoor', startTime: new Date(run.startTime.getTime() + 1000) }]).status).toBe('strong_unique');
    expect(matchGarminActivity({ ...indoor, elapsedTimeS: null, movingTimeS: null }, [{ ...indoor, id: 'indoor' }]).status).toBe('ambiguous');
  });
  it('never approximately auto-links gym sessions or resolves repeated sessions by order', () => {
    const gym = { ...run, activityType: 'workout' as const, subtype: 'indoor' as const, distanceM: null };
    expect(matchGarminActivity(gym, [{ ...gym, id: 'gym' }]).status).toBe('exact');
    expect(matchGarminActivity(gym, [{ ...gym, id: 'gym', elapsedTimeS: 1810 }]).status).toBe('ambiguous');
    expect(matchGarminActivity(gym, [{ ...gym, id: 'a' }, { ...gym, id: 'b' }]).status).toBe('ambiguous');
  });
  it('bounds candidates and rejects invalid timestamps/metrics', () => {
    expect(() => matchGarminActivity({ ...run, startTime: new Date(NaN) }, [])).toThrow();
    expect(() => matchGarminActivity({ ...run, distanceM: NaN }, [])).toThrow();
    expect(() => matchGarminActivity(run, Array.from({ length: 101 }, () => candidate()))).toThrow();
  });
});
