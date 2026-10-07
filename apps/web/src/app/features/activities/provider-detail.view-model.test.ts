import { describe, expect, it } from 'vitest';
import { exerciseSetRows, fitMetrics, stravaMetrics } from './provider-detail.view-model';
describe('provider-specific retained metric views', () => {
  it('keeps FIT units unchanged and omits unavailable or unknown metrics', () => {
    expect(fitMetrics({message:'session',fields:[{name:'avg_stance_time',value:250.125,units:'ms'},{name:'avg_power',value:null,units:'watts'},{name:'position_lat',value:123,units:'semicircles'}]})).toEqual([{label:'avg stance time',value:'250.13 ms'}]);
  });
  it('preserves exercise weight/count/unit fields without calculating or converting', () => {
    expect(exerciseSetRows({exerciseSets:[{repetitionCount:10,weight:20000,weightUnit:'grams'}]})).toEqual([[{label:'repetition Count',value:'10'},{label:'weight',value:'20000'},{label:'weight Unit',value:'grams'}]]);
    expect(exerciseSetRows({availability:'unavailable'})).toEqual([]);
  });
  it('only displays finite source-specific Strava numbers', () => {
    expect(stravaMetrics({average_watts:180,max_watts:null,suffer_score:'unknown',notes:'private'})).toEqual([{label:'average watts',value:'180'}]);
  });
});
