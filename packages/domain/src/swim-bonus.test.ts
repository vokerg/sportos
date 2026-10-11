import { describe, expect, it } from 'vitest';
import { scoreDay, scoreActivityWithRule } from './scoring.js';
import { validateRuleProposal } from './rules-studio.js';
import type { ActivityFact, ScoringRule } from './types.js';
const date = '2026-05-18';
const tiers: ScoringRule[] = [
  ['sub20',1200,2000], ['sub19m30',1170,3000], ['sub19',1140,4000], ['sub18m30',1110,5000],
].map(([name, threshold, points], i) => ({id:`rule-${i}`,code:`swim.1k.${name}.bonus`,name:`Swim ${name}`,activityType:'swim',ruleKind:'achievement',metric:'pace_s_per_km',thresholdOperator:'lt',thresholdValue:Number(threshold),thresholdUnit:'s/km',points:Number(points),achievementGroup:'swim.pace.1k',validFrom:'1900-01-01',priority:90+i,enabled:true}));
const swim = (overrides: Partial<ActivityFact> = {}): ActivityFact => ({id:'swim',activityDate:date,activityType:'swim',distanceM:1000,durationS:1133,...overrides});
function score(activities: ActivityFact[], rules = tiers) {
  return scoreDay({metricDate:date,steps:0,runM:0,bikeM:0,swimM:activities.reduce((s,a)=>s+(a.distanceM??0),0),workoutPoints:0,bonusPoints:0},activities,rules);
}
describe('one highest swim bonus per canonical activity', () => {
  it.each([[1200,0],[1199,2000],[1170,2000],[1169,3000],[1140,3000],[1139,4000],[1110,4000],[1109,5000],[900,5000]])('awards %s seconds the strict tier of %s points', (durationS, points) => {
    const result = score([swim({durationS})]);
    expect(result.bonusPoints).toBe(points); expect(result.ledger).toHaveLength(points ? 1 : 0);
  });
  it('uses elapsed pace for longer swims without multiplying or stacking tiers', () => {
    expect(score([swim({distanceM:2000,durationS:2266,movingTimeS:2000})])).toMatchObject({bonusPoints:4000,ledger:[{points:4000,calculationJson:{metricValue:1133,multiplierValue:1,achievementGroup:'swim.pace.1k'}}]});
  });
  it('keeps base swim points and exact tier UUID/explanation', () => {
    const base: ScoringRule = {id:'base',code:'swim.m.default',name:'Swim',activityType:'swim',ruleKind:'coefficient',metric:'distance_m',coefficient:7.5,validFrom:'1900-01-01',priority:40,enabled:true};
    const result = score([swim()], [base,...tiers]);
    expect(result).toMatchObject({basePoints:7500,bonusPoints:4000,totalPoints:11500});
    expect(result.ledger[1]).toMatchObject({activityId:'swim',ruleId:'rule-2',ruleCode:'swim.1k.sub19.bonus',calculationJson:{metric:'pace_s_per_km',metricValue:1133,thresholdOperator:'lt',thresholdValue:1140,eligibilityRounding:null,pointsMultiplier:null,awardedPoints:4000}});
  });
  it.each([{distanceM:999.99},{distanceM:0},{distanceM:NaN},{distanceM:Infinity},{durationS:undefined},{durationS:0},{durationS:-1},{durationS:NaN},{durationS:Infinity}])('rejects short, missing or invalid inputs %j', overrides => {
    expect(score([swim(overrides)]).bonusPoints).toBe(0);
  });
  it('does not combine short sessions and gives each qualifying swim one bonus', () => {
    expect(score([swim({id:'a',distanceM:500,durationS:500}),swim({id:'b',distanceM:500,durationS:500})]).bonusPoints).toBe(0);
    expect(score([swim({id:'a'}),swim({id:'b',durationS:1100})])).toMatchObject({bonusPoints:9000,ledger:[{activityId:'a',points:4000},{activityId:'b',points:5000}]});
  });
  it('respects enabled/effective versions and retains the legacy duration rule semantics', () => {
    expect(score([swim()],tiers.map(t=>({...t,enabled:false}))).bonusPoints).toBe(0);
    expect(score([swim()],tiers.map(t=>({...t,validFrom:'2027-01-01'}))).bonusPoints).toBe(0);
    expect(score([swim({activityDate:'2026-05-19'})]).bonusPoints).toBe(0);
    const legacy = {...tiers[0],achievementGroup:undefined,metric:'duration_s',thresholdUnit:'s',points:1000};
    expect(scoreActivityWithRule(swim(),legacy,date)?.points).toBe(1000);
  });
  it('accepts swim pace proposals for Rules Studio and preview', () => {
    expect(validateRuleProposal({...tiers[0],pointsMultiplier:undefined})).toMatchObject({metric:'pace_s_per_km',achievementGroup:'swim.pace.1k'});
  });
});
