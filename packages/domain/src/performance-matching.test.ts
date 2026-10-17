import { describe, it, expect } from 'vitest';
import { matchHistoricalPerformance as match, performanceTarget } from './performance-matching.js';
const record = { id:'event', date:'2026-05-01', distanceM:5000, durationS:1200, treadmill:false };
const candidate = { id:'fast', date:record.date, distanceM:10040, movingTimeS:2410, subtype:'outdoor' };
describe('historical workout matching', () => {
  it('allows multiple distances to share a summary-only workout', () => {
    expect(match(record,[candidate]).activityId).toBe('fast');
    expect(match({...record,distanceM:10000,durationS:2400},[candidate]).activityId).toBe('fast');
  });
  it('uses strong pace contrast but rejects close candidates', () => {
    expect(match(record,[candidate,{...candidate,id:'slow',movingTimeS:3012}]).activityId).toBe('fast');
    expect(match(record,[candidate,{...candidate,id:'close',movingTimeS:2450}]).status).toBe('ambiguous');
  });
  it('permits a fast subdistance in a longer slower run', () => {
    expect(match(record,[{...candidate,movingTimeS:2900}]).status).toBe('accepted');
  });
  it('rejects date drift, treadmill mismatch, short runs and impossible pace', () => {
    for(const c of [{...candidate,date:'2026-04-30'},{...candidate,subtype:'treadmill'},{...candidate,distanceM:4900},{...candidate,movingTimeS:200}])
      expect(match(record,[c]).activityId).toBeNull();
  });
  it('preserves source distance semantics while normalizing the catalog', () => {
    expect(performanceTarget(21100)).toBe(21097.5); expect(performanceTarget(12000)).toBeNull(); expect(performanceTarget(42195)).toBe(42195);
    expect(match({...record,distanceM:12000},[candidate]).status).toBe('unmatched');
  });
  it('is stable under candidate input ordering and never edits records', () => {
    const input=structuredClone(record), other={...candidate,id:'other'};
    expect(match(input,[candidate,other])).toEqual(match(input,[other,candidate])); expect(input).toEqual(record);
  });
});
