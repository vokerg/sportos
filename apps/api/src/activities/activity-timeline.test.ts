import { describe, expect, it } from 'vitest';
import { garminTimeline, stravaTimeline, simplify } from './activity-timeline.js';
const stream = (data: unknown[]) => ({data, series_type:'time', resolution:'high', original_size:3});
const field = (name:string,value:unknown,units:string|null=null) => ({name,value,units});
const record = (seconds:number, fields:unknown[] = []) => ({message:'record',fields:[field('timestamp',new Date(Date.UTC(2026,0,1,0,0,seconds)).toISOString()),...fields]});
describe('retained activity timelines',()=>{
  it('converts pace/speed/distance, preserves zero power and omits absent metrics without estimating from summaries',()=>{
    const result = stravaTimeline({time:stream([0,1,2]),velocity_smooth:stream([4,0,5]),watts:stream([300,0,null]),distance:stream([0,4,9]),avg_hr:150});
    expect(result.status).toBe('available');
    expect(result.metrics.find(m=>m.key==='pace')?.points).toEqual([[0,1000/4/60],[1,null],[2,1000/5/60]]);
    expect(result.metrics.find(m=>m.key==='power')?.points).toEqual([[0,300],[1,0],[2,null]]);
    expect(result.metrics.find(m=>m.key==='distance')?.points[2]).toEqual([2,.009]);
    expect(result.metrics.some(m=>m.key==='heartRate')).toBe(false);
  });
  it('reads array streams, rejects misaligned sampling metadata and invalid/nonmonotonic timelines',()=>{
    expect(stravaTimeline([{type:'time',...stream([0,1,2])},{type:'heartrate',...stream([100,110,120])}]).status).toBe('available');
    expect(stravaTimeline({time:stream([0,1,2]),heartrate:{...stream([100,110,120]),resolution:'low'}}).reason).toBe('no_supported_metrics');
    for(const times of [[0,0,1],[1,0,2],[0,1,Infinity],[0,1,'2'],[-1,0,1],[0,1,604801]]) expect(stravaTimeline({time:stream(times),watts:stream([1,2,3])}).status).toBe('unavailable');
    expect(stravaTimeline({time:stream(new Array(150001).fill(0))}).reason).toBe('sample_limit_or_missing');
  });
  it('keeps missing values and recording gaps open rather than interpolating',()=>{
    const r=stravaTimeline({time:stream([0,1,90]),heartrate:stream([100,null,110])});
    expect(r.metrics[0]?.points).toEqual([[0,100],[1,null],[1.001,null],[90,110]]);
  });
  it('parses native FIT fields only with explicit units and timestamps, ignoring vendor fields and non-record messages',()=>{
    const r=garminTimeline([{message:'session',fields:[]},record(0,[field('enhanced_speed',4,'m/s'),field('heart_rate',150,'bpm'),field('stance_time',210,'ms'),field('power',300,'watts')]),record(1,[field('speed',5,'m/s'),field('heart_rate',151,'bpm'),field('power',999,'unknown')])]);
    expect(r.status).toBe('available'); expect(r.sampleCount).toBe(2);
    expect(r.metrics.find(m=>m.key==='groundContact')?.points).toEqual([[0,210],[1,null]]);
    expect(r.metrics.find(m=>m.key==='power')?.points).toEqual([[0,300],[1,null]]);
    expect(garminTimeline([record(0,[{...field('power',400,'watts'),developerIndex:0}])]).reason).toBe('no_supported_metrics');
    expect(garminTimeline([{message:'record',fields:[field('timestamp','2026-01-01T00:00:00')]}]).reason).toBe('invalid_timeline');
    expect(garminTimeline([record(0),record(0)])).toMatchObject({status:'unavailable',reason:'invalid_timeline'});
    expect(garminTimeline([record(0,[field('power',1,'watts'),field('power',2,'watts')])]).reason).toBe('invalid_timeline');
  });
  it('bounds display size, preserves extrema without gaps, and retains missing markers when simplified',()=>{
    const points:[number,number|null][]=Array.from({length:10000},(_,i)=>[i,100]);
    points[123]=[123,999]; points[456]=[456,-1];
    const reduced=simplify(points);expect(reduced.length).toBeLessThanOrEqual(2800);expect(reduced).toContainEqual([123,999]);expect(reduced).toContainEqual([456,-1]);
    points[125]=[125,null];const gaps=simplify(points);expect(gaps).toContainEqual([125,null]);expect(gaps[0]).toEqual(points[0]);expect(gaps.at(-1)).toEqual(points.at(-1));
  });
});
