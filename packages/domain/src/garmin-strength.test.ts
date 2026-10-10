import { describe, expect, it } from 'vitest';
import { normalizeGarminStrength, workoutPointsFromSets } from './garmin-strength.js';
describe('retained Garmin strength policy v1', () => {
  it('counts explicit working sets only without requiring reps or weight', () => {
    expect(normalizeGarminStrength([{exerciseSets: [
      {setType:'ACTIVE', exerciseName:'Squat'}, {setType:'WORK', exerciseName:'Squat'},
      {setType:'PERFORMED', exerciseName:'Press'}, {setType:'REST'}, {setType:'RECOVERY'},
      {setType:'WARMUP'}, {setType:'WARM_UP'}, {setType:'other', repetitions:12, weight:20}, {repetitions:10},
    ]}])).toEqual({policyVersion:1,totalRecordedSets:9,workingSets:3,warmupSets:2,restMarkers:2,unknownSets:2,
      exerciseCount:2,exercises:[{name:'Press',workingSets:1},{name:'Squat',workingSets:2}],complete:false});
  });
  it.each([null,{}, {exerciseSets:null}, {exerciseSets:[]}, {availability:'unavailable'}, {exerciseSets:Array(2001).fill({setType:'ACTIVE'})}])('fails closed for absent/unsupported/oversized payload %j', payload => {
    expect(normalizeGarminStrength([payload]).complete).toBe(false);
  });
  it('combines declared retained chunks with bounded labels', () => {
    expect(normalizeGarminStrength([{exerciseSets:[{setType:'ACTIVE',exerciseName:'Press'}]}, {exerciseSets:[{setType:'REST'}]}]))
      .toMatchObject({totalRecordedSets:2,workingSets:1,complete:true});
  });
  it.each([[1,333],[2,667],[3,1000],[4,1333],[6,2000]])('converts %i sets to %i points', (sets,points) => expect(workoutPointsFromSets(sets)).toBe(points));
});
