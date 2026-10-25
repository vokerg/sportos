import { describe, expect, it } from 'vitest';
import { runLaps, runLapChart } from './run-laps.models';
import type { ActivityProviderDetailResponse, GarminDetail } from '../activities-api.service';
const strava = (payload:unknown, availability:'available'|'unavailable'='available') => ({provider:'strava',providerActivityId:'synthetic',fetchedAt:'2026-01-01',cacheStatus:'hit',resources:{laps:{payload,availability,httpStatus:200}}}) as ActivityProviderDetailResponse;
const field = (name:string,value:unknown,units:string|null) => ({name,value,units});
const garmin = (fields:ReturnType<typeof field>[]) => ({laps:[{message:'lap',fields}]}) as GarminDetail;
describe('retained running laps',()=>{
  it('preserves fractional partial laps, recovery laps and missing HR without changing source values',()=>{
    const source = strava([{distance:400.5,moving_time:90.125,elapsed_time:93,average_heartrate:155},{distance:100,moving_time:60},{distance:0,moving_time:20}]);
    const data=runLaps('strava',source,null);
    expect(data.rows.map(r=>r.distanceM)).toEqual([400.5,100,0]);
    expect(data.rows[0]).toMatchObject({durationS:90.125,durationBasis:'moving',elapsedS:93,heartRate:155});
    expect(data.rows[0]!.paceSPerKm).toBe(90.125*1000/400.5);
    expect(data.rows[1]!.heartRate).toBeNull();expect(data.rows[2]!.paceSPerKm).toBeNull();
    expect((source.resources['laps']!.payload as any[])[0].distance).toBe(400.5);
  });
  it('labels elapsed fallback, retains zero timer time and rejects strings, negative and nonfinite values',()=>{
    const data=runLaps('strava',strava([{distance:1000,elapsed_time:300},{distance:1000,moving_time:0,elapsed_time:20},{distance:'1000',moving_time:-1,elapsed_time:Infinity,average_heartrate:0}]),null);
    expect(data.rows[0]).toMatchObject({durationBasis:'elapsed',paceSPerKm:300});
    expect(data.rows[1]).toMatchObject({durationBasis:'moving',durationS:0,paceSPerKm:null});
    expect(data.rows[2]).toMatchObject({distanceM:null,durationS:null,heartRate:null});
  });
  it('accepts only unambiguous native Garmin fields with explicit expected units',()=>{
    const data=runLaps('garmin',null,garmin([field('total_distance',1000,'m'),field('total_timer_time',240.5,'s'),field('total_elapsed_time',260,'s'),field('avg_heart_rate',160,'bpm')]));
    expect(data.rows[0]).toMatchObject({distanceM:1000,paceSPerKm:240.5,durationBasis:'timer',heartRate:160});
    const invalid=runLaps('garmin',null,garmin([field('total_distance',1,'km'),field('total_timer_time',30,'s'),field('total_timer_time',40,'s'),{...field('avg_heart_rate',170,'bpm'),developerIndex:0} as any]));
    expect(invalid.rows[0]).toMatchObject({distanceM:null,durationS:null,heartRate:null});
  });
  it('handles unavailable and malformed resources and bounds long lists',()=>{
    expect(runLaps('strava',strava([{distance:1}],'unavailable'),null).rows).toEqual([]);
    expect(runLaps('strava',strava({laps:[]}),null).rows).toEqual([]);
    expect(runLaps('strava',strava([null,5,[]]),null).rows).toEqual([]);
    const data=runLaps('strava',strava(Array.from({length:1001},()=>({distance:1000,moving_time:300}))),null);
    expect(data.rows).toHaveLength(1000);expect(data.bounded).toBe(true);
  });
  it('uses separate synchronized axes and leaves missing points as gaps',()=>{
    const chart=runLapChart(runLaps('strava',strava([{distance:1000,moving_time:300,average_heartrate:150},{distance:0,moving_time:20}]),null))!;
    const options=chart.options as any;
    expect(options.series.map((s:any)=>s.data)).toEqual([[300,null],[150,null]]);
    expect(options.yAxis.map((a:any)=>a.inverse)).toEqual([true,false]);
    expect(options.series.every((s:any)=>s.connectNulls===false)).toBe(true);
    expect(options.dataZoom.every((z:any)=>z.xAxisIndex.length===2)).toBe(true);
    expect(chart.height).toBe(380);
    expect(runLapChart({rows:[],bounded:false})).toBeNull();
  });
});
