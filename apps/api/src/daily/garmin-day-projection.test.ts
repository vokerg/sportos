import { describe, expect, it } from 'vitest';
import { projectGarminDay, publicGarminPayload, hasGarminDayEvidence, nonScoringGarminDayIdentities } from './garmin-day-projection.js';
const date='2026-03-29';
describe('Garmin day projection', () => {
  it('preserves exact day totals and missing fields', () => {
    expect(projectGarminDay('summary',{calendarDate:date,totalSteps:12345,totalDistanceMeters:8000,totalKilocalories:2400,activeKilocalories:500},date)).toMatchObject({steps:12345,distanceM:8000,totalCalories:2400,activeCalories:500,restingCalories:null});
    expect(() => projectGarminDay('summary',{calendarDate:'2026-03-28',totalSteps:1},date)).toThrow('date');
    expect(() => projectGarminDay('summary',{totalSteps:'123'},date)).toThrow('metric');
  });
  it('keeps all timestamped weigh-ins with gram conversions and null composition', () => {
    const result=projectGarminDay('weight',{dateWeightList:[{calendarDate:date,timestampGMT:1774738800000,weight:70000,bmi:22,bodyFat:18,muscleMass:32000,boneMass:3000,bodyWater:60},{calendarDate:date,timestampGMT:1774746000000,weight:70500}]},date);
    expect(result).toMatchObject({measurements:[{weightKg:70,bmi:22,bodyFatPct:18,muscleMassKg:32,boneMassKg:3,bodyWaterPct:60},{weightKg:70.5,bmi:null,bodyFatPct:null,muscleMassKg:null,boneMassKg:null,bodyWaterPct:null}]});
    expect((result as {measurements:{recordedAt:string}[]}).measurements[0]?.recordedAt).not.toEqual((result as {measurements:{recordedAt:string}[]}).measurements[1]?.recordedAt);
  });
  it('retains only supported compact recovery metrics without guessing', () => {
    expect(projectGarminDay('sleep',{dailySleepDTO:{calendarDate:date,sleepTimeSeconds:28800,deepSleepSeconds:3600}},date)).toMatchObject({sleepSeconds:28800,deepSleepSeconds:3600,remSleepSeconds:null});
    expect(projectGarminDay('hrv',null,date)).toEqual({});
    expect(hasGarminDayEvidence('sleep',projectGarminDay('sleep',{dailySleepDTO:{calendarDate:date,sleepTimeSeconds:null,deepSleepSeconds:null}},date))).toBe(false);
    expect(hasGarminDayEvidence('summary',projectGarminDay('summary',{calendarDate:date,totalSteps:0},date))).toBe(true);
    expect(projectGarminDay('hrv',{hrvSummary:{calendarDate:date,lastNightAvg:55}},date)).toMatchObject({lastNightAvgMs:55});
    expect(projectGarminDay('body_battery',[{date,charged:70,drained:30}],date)).toEqual({charged:70,drained:30});
  });
  it('retains compact activity identities with local calendar semantics', () => {
    expect(projectGarminDay('activities',{items:[{activityId:123,startTimeLocal:`${date} 00:05:00`,startTimeGMT:'2026-03-28 23:05:00'}],complete:true},date)).toEqual({identities:['native:123'],complete:true});
    expect(() => projectGarminDay('activities',{items:[{activityId:123,startTimeLocal:'2026-03-28 23:05:00'}],complete:true},date)).toThrow();
  });
  it('excludes credentials, account references, hashes and paths from resource disclosure', () => {
    const value=publicGarminPayload({userProfileId:1,displayName:'private',password:'private',nested:{token:'private',filePath:'private',objectKey:'private',owner_id:'private',totalSteps:5}});
    expect(value).toEqual({nested:{totalSteps:5}});
  });
});

it('excludes only explicit walking from strength-required extraction, retaining unknown and strength types',()=>{
  expect(nonScoringGarminDayIdentities({items:[{activityId:'1',activityType:{typeKey:'walking'}},{activityId:'2',activityType:{typeKey:'strength_training'}},{activityId:'3',activityType:{typeKey:'unknown'}}]})).toEqual(['native:1']);
  expect(nonScoringGarminDayIdentities(null)).toEqual([]);
});
