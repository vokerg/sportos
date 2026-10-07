import { describe, expect, it } from 'vitest';
import { resolveDailyWorkout, type WorkoutSetEvidence } from './daily-workout-resolution.js';
import { attachWorkoutCalculation } from './daily-scoring.repository.js';
const evidence: WorkoutSetEvidence = {activityId:'a',identityId:'g',workingSets:1,complete:true,sourceVersionId:'v',sourceUpdatedAt:'2026-10-03T10:00:00Z',derivedAt:'2026-10-03T11:00:00Z'};
describe('daily workout source authority',()=>{
  it('aggregates unique identities and rounds once across the day',()=>{
    const result=resolveDailyWorkout(9000,[],true,[evidence,evidence,{...evidence,identityId:'g2',activityId:'b'}]);
    expect(result).toMatchObject({source:'garmin_sets',workingSets:2,resolvedPoints:667,policyVersion:1,pointsPerThreeSets:1000});
    expect(result.activities).toHaveLength(2);
  });
  it('positive manual wins and zero unlocks Garmin',()=>{
    const manual={activityDate:'2026-10-03',activityType:'workout' as const,source:'manual' as const,effortPoints:123};
    expect(resolveDailyWorkout(123,[manual],false,[evidence])).toEqual({source:'manual',resolvedPoints:123});
    expect(resolveDailyWorkout(0,[{...manual,effortPoints:0}],false,[evidence])).toMatchObject({source:'garmin_sets',resolvedPoints:333});
  });
  it('preserves stored/imported values for absent, partial, failed or unknown evidence',()=>{
    expect(resolveDailyWorkout(9000,[],true,[])).toEqual({source:'imported',resolvedPoints:9000});
    expect(resolveDailyWorkout(9000,[],false,[{...evidence,complete:false}])).toMatchObject({source:'stored',resolvedPoints:9000,incompleteReason:expect.any(String)});
    expect(resolveDailyWorkout(9000,[],true,[evidence],'Discovery is partial.')).toEqual({source:'imported',resolvedPoints:9000,incompleteReason:'Discovery is partial.'});
  });
  it('attaches provenance only to workout base ledger contributions',()=>{
    const calculation=resolveDailyWorkout(0,[],false,[evidence]);
    const score=attachWorkoutCalculation({ledger:[{calculationJson:{activityType:'workout',classification:'base'}},{calculationJson:{activityType:'workout',classification:'bonus'}},{calculationJson:{activityType:'run',classification:'base'}}]},calculation);
    expect(score.ledger[0]?.calculationJson).toHaveProperty('workoutCalculation',calculation);
    expect(score.ledger[1]?.calculationJson).not.toHaveProperty('workoutCalculation');
    expect(score.ledger[2]?.calculationJson).not.toHaveProperty('workoutCalculation');
  });
});
