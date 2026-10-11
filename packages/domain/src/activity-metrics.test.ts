import { describe, expect, it } from 'vitest';
import { ACTIVITY_METRIC_CATALOG, inspectActivityMetrics, selectProviderMetrics, type MetricInput } from './activity-metrics.js';
const fit=(fields:{name:string;value:unknown;units:string|null;developerIndex?:number|null}[]):MetricInput=>({provider:'garmin',sourceKind:'fit_session',fields:{message:'session',fields}});
const strava=(fields:unknown,sourceKind:MetricInput['sourceKind']='compact'):MetricInput=>({provider:'strava',sourceKind,fields});
describe('provider activity catalog v1',()=>{
  it('preserves disagreements and labels derived pace without replacing canonical authority',()=>{
    expect(()=>inspectActivityMetrics('run',[strava({distance:10020}),fit([{name:'total_distance',value:10000,units:'m'}])])).toThrow('one provider');
    const a=inspectActivityMetrics('run',[strava({distance:10020,moving_time:3000,elapsed_time:3100,average_heartrate:155,average_watts:230,suffer_score:40})]);
    const b=inspectActivityMetrics('run',[fit([{name:'total_distance',value:10000,units:'m'},{name:'total_timer_time',value:2999,units:'s'},{name:'avg_power',value:232,units:'watts'}])]);
    expect(a.observations.find(m=>m.metricKey==='distance')?.value).toBe(10020);
    expect(b.observations.find(m=>m.metricKey==='distance')?.value).toBe(10000);
    expect(a.observations.find(m=>m.metricKey==='average_pace')).toMatchObject({value:3000*1000/10020,origin:'calculated'});
    expect(b.observations.find(m=>m.metricKey==='average_pace')).toBeUndefined();
    expect(b.observations.find(m=>m.metricKey==='moving_duration')).toBeUndefined();
  });
  it('normalizes decoded running dynamics and rejects unknown units/developer fields',()=>{
    const output=inspectActivityMetrics('run',[fit([{name:'avg_running_cadence',value:90,units:'strides/min'},
      {name:'avg_step_length',value:1100,units:'mm'},{name:'avg_vertical_oscillation',value:9,units:'cm'},
      {name:'avg_stance_time',value:250,units:'ms'},{name:'avg_power',value:500,units:'watts',developerIndex:0},
      {name:'custom_dynamics',value:12,units:'mm'},{name:'avg_stance_time_balance',value:49.5,units:'percent'}])]);
    expect(output.observations).toEqual(expect.arrayContaining([expect.objectContaining({metricKey:'running_cadence',value:180,unit:'steps/min'}),expect.objectContaining({metricKey:'step_length',value:1.1,unit:'m'})]));
    expect(output.observations.some(m=>['vertical_oscillation','average_power','custom_dynamics'].includes(m.metricKey))).toBe(false);
    expect(output.rejected).toBe(1);
  });
  it('uses deterministic within-provider precedence while keeping summary and FIT alternatives',()=>{
    const output=inspectActivityMetrics('run',[{provider:'garmin',sourceKind:'compact',fields:{distanceM:10000}},fit([{name:'total_distance',value:9998,units:'m'},{name:'avg_speed',value:3,units:'m/s'},{name:'enhanced_avg_speed',value:3.1,units:'m/s'}])]);
    expect(output.observations.filter(m=>m.metricKey==='distance')).toHaveLength(2);
    expect(selectProviderMetrics(output.observations).find(m=>m.metricKey==='distance')?.value).toBe(9998);
    expect(selectProviderMetrics(output.observations).find(m=>m.metricKey==='average_speed')?.value).toBe(3.1);
    expect(selectProviderMetrics([...output.observations].reverse())).toEqual(selectProviderMetrics(output.observations));
  });
  it('never equates training indices or weighted power with normalized power',()=>{
    const output=inspectActivityMetrics('bike',[strava({weighted_average_watts:250,kilojoules:600,suffer_score:55})]);
    expect(output.observations.map(m=>m.metricKey)).toEqual(['weighted_average_power','total_work','relative_effort']);
    const garmin=inspectActivityMetrics('bike',[fit([{name:'normalized_power',value:260,units:'watts'},{name:'total_work',value:600000,units:'J'},{name:'total_training_effect',value:3.2,units:null},{name:'total_anaerobic_training_effect',value:1.5,units:''},{name:'training_stress_score',value:45,units:'tss'}])]);
    expect(garmin.observations).toEqual(expect.arrayContaining([expect.objectContaining({metricKey:'total_work',value:600}),expect.objectContaining({metricKey:'normalized_power',value:260})]));
  });
  it('supports verified swimming and paddlesport fields with sport-specific units',()=>{
    const swim=inspectActivityMetrics('swim',[fit([{name:'pool_length',value:25,units:'m'},{name:'num_lengths',value:40,units:'lengths'},{name:'avg_swolf',value:35,units:''},{name:'avg_swimming_cadence',value:30,units:'strokes/min'}])]);
    expect(swim.observations.map(m=>m.metricKey)).toEqual(['pool_length','length_count','stroke_rate','swolf']);
    const sup=inspectActivityMetrics('sup',[fit([{name:'stroke_count',value:1200,units:'counts'},{name:'avg_paddlesport_cadence',value:40,units:'strokes/min'},{name:'avg_stroke_distance',value:2.5,units:'m'}])]);
    expect(sup.observations.map(m=>m.metricKey)).toEqual(['stroke_count','stroke_rate','distance_per_stroke']);
    expect(inspectActivityMetrics('run',[fit([{name:'pool_length',value:25,units:'m'}])]).observations).toEqual([]);
  });
  it('missing/unparsed is never zero; accepts evidenced zero and rejects nonfinite/out-of-bounds values',()=>{
    const output=inspectActivityMetrics('bike',[strava({distance:null,calories:0,average_watts:'250',max_watts:Infinity,average_heartrate:-2,average_temp:-5})]);
    expect(output.observations).toEqual(expect.arrayContaining([expect.objectContaining({metricKey:'calories',value:0}),expect.objectContaining({metricKey:'average_temperature',value:-5})]));
    expect(output.observations.find(m=>m.metricKey==='distance')).toBeUndefined();expect(output.rejected).toBe(3);expect(output.missing).toBeGreaterThan(0);
    expect(inspectActivityMetrics('run',[fit([{name:'total_distance',value:5,units:'m'},{name:'total_distance',value:6,units:'m'}])]).observations).toEqual([]);
  });
  it('reuses compact strength counts and keeps a bounded unique scalar catalog',()=>{
    const output=inspectActivityMetrics('workout',[{provider:'garmin',sourceKind:'strength_summary',fields:{workingSets:3,totalRecordedSets:5,unknownSets:1,exerciseCount:2,exercises:[{name:'private'}]}}]);
    expect(output.observations).toHaveLength(4);expect(output.observations.some(m=>m.sourceField==='exercises')).toBe(false);
    expect(new Set(ACTIVITY_METRIC_CATALOG.map(m=>m.key)).size).toBe(ACTIVITY_METRIC_CATALOG.length);
    expect(ACTIVITY_METRIC_CATALOG.length).toBeLessThan(100);
  });
});
