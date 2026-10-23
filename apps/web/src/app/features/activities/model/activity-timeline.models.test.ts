import { describe, expect, it } from 'vitest';
import { timelineOptions, timelineReason, timelineTime, timelineValue, type ActivityTimeline } from './activity-timeline.models';
const data:ActivityTimeline={source:'strava',status:'available',sampleCount:3,durationS:90,simplified:false,metrics:[
  {key:'pace',label:'Pace',unit:'min/km',points:[[0,4],[1,null],[90,5]]},
  {key:'power',label:'Power',unit:'W',points:[[0,300],[1,0],[90,400]]},
]};
describe('activity timeline chart model',()=>{
  it('uses native elapsed offsets and independent axes with inverse pace and synchronized zoom',()=>{
    const options=timelineOptions(data,data.metrics) as any;
    expect(options.xAxis.map((axis:any)=>axis.max)).toEqual([90,90]);
    expect(options.yAxis.map((axis:any)=>axis.inverse)).toEqual([true,false]);
    expect(options.yAxis[0].nameLocation).toBe('start');
    expect(options.series[0].data).toEqual(data.metrics[0]!.points);
    expect(options.series.every((series:any)=>!series.connectNulls)).toBe(true);
    expect(options.dataZoom.every((zoom:any)=>zoom.xAxisIndex.join(',')==='0,1')).toBe(true);
    expect(options.axisPointer.link).toEqual([{xAxisIndex:'all'}]);
    expect(options.tooltip.formatter([{seriesIndex:0,data:[90,5]},{seriesIndex:1,data:[90,400]}])).toContain('Power: 400 W');
  });
  it('handles a single selected metric without stale axes or series',()=>{
    const options=timelineOptions(data,[data.metrics[1]!]) as any;
    expect(options.series).toHaveLength(1);expect(options.series[0].id).toBe('power');expect(options.series[0].yAxisIndex).toBe(0);
  });
  it('formats durations and pace and explains unavailable data without inventing numbers',()=>{
    const swimPace = {...data.metrics[0]!, unit:'min/100m'};
    expect(timelineValue(1.5,swimPace)).toBe('1:30 /100m');
    expect(timelineTime(3601)).toBe('1:00:01');expect(timelineValue(4.5,data.metrics[0]!)).toBe('4:30 /km');
    expect(timelineValue(null,data.metrics[1]!)).toBe('—');expect(timelineValue(0,data.metrics[1]!)).toBe('0 W');
    expect(timelineReason('stale')).toContain('older activity version');expect(timelineReason('unknown')).toContain('No supported');
  });
});
