import { describe, expect, it } from 'vitest';
import { matchGarminActivity, type ActivityMatchSummary } from './activity-matching.js';
const run: ActivityMatchSummary = { activityType: 'run', subtype: 'outdoor', startTime: new Date('2026-10-25T02:30:00+02:00'), elapsedTimeS: 1800, movingTimeS: 1750, distanceM: 5000 };
const candidate = (changes = {}) => ({ ...run, id: 'canonical', ...changes });
describe('Garmin matching policy v2', () => {
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
  it('requires tight start/elapsed agreement for gym sessions or resolves repeated sessions by order', () => {
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

describe('sport-aware v2 matching criteria',()=>{
  it('accepts rounded gym elapsed time without confusing active lifting time with Strava moving time',()=>{
    const gym={...run,activityType:'workout' as const,subtype:'indoor' as const,elapsedTimeS:1800.8,movingTimeS:900,distanceM:0};
    expect(matchGarminActivity(gym,[{...gym,id:'gym',elapsedTimeS:1800,movingTimeS:1800}])).toMatchObject({policyVersion:2,status:'strong_unique',activityId:'gym'});
    expect(matchGarminActivity(gym,[{...gym,id:'gym',elapsedTimeS:1804}]).status).toBe('ambiguous');
    expect(matchGarminActivity(gym,[{...gym,id:'gym',startTime:new Date(gym.startTime.getTime()+3000)}]).status).toBe('ambiguous');
    expect(matchGarminActivity(gym,[{...gym,id:'gym',elapsedTimeS:null}]).status).toBe('ambiguous');
  });
  it.each(['run','bike','swim','rowing','sup'] as const)('accepts fractional-to-integer duration precision for %s with independent distance evidence',activityType=>{
    const source={...run,activityType,elapsedTimeS:1800.8};
    expect(matchGarminActivity(source,[{...source,id:'a',elapsedTimeS:1800}])).toMatchObject({status:'strong_unique',policyVersion:2});
    expect(matchGarminActivity(source,[{...source,id:'a',movingTimeS:900}]).status).toBe('ambiguous');
  });
  it('uses a pool-length floor instead of 200m tolerance for short indoor swims',()=>{
    const swim={...run,activityType:'swim' as const,subtype:'indoor' as const,distanceM:75};
    expect(matchGarminActivity(swim,[{...swim,id:'a',distanceM:175}]).status).toBe('ambiguous');
    expect(matchGarminActivity(swim,[{...swim,id:'a',distanceM:100}]).status).toBe('strong_unique');
  });
  it('never uses unknown no-GPS subtype, zero duration, same day or candidate ordering as evidence',()=>{
    const source={...run,distanceM:null,subtype:'unknown' as const};
    expect(matchGarminActivity(source,[{...source,id:'a',elapsedTimeS:1801}]).status).toBe('ambiguous');
    expect(matchGarminActivity({...run,elapsedTimeS:0,movingTimeS:0},[{...run,id:'a',elapsedTimeS:0,movingTimeS:0}]).status).toBe('ambiguous');
    const candidates=[candidate(),candidate({id:'b',startTime:new Date(run.startTime.getTime()+60000)})];
    expect(matchGarminActivity(run,candidates)).toEqual(matchGarminActivity(run,candidates.reverse()));
  });
});
