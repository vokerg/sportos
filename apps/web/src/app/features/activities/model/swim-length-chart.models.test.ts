import { describe, expect, it } from 'vitest';
import { swimLengthChartOptions, swimLengthChartHeight, swimSplitTime } from './swim-length-chart.models';
import type { SwimLengthResponse } from '../activities-api.service';
const row = (row:number, kind:'active'|'rest', paceSPer100M:number|null, strokes:number|null, swolf:number|null) => ({
 row,lengthNumber:kind==='active'?row:null,kind,durationS:20,durationBasis:'timer' as const,paceSPer100M,strokes,swolf,stroke:null,
});
const base:SwimLengthResponse = {status:'available',poolLengthM:25,poolLengthDisplay:'25 m',
 expectedLengths:3,expectedActiveLengths:2,complete:true,truncated:false,lengths:[row(1,'active',100,17,42),row(2,'rest',null,null,null),row(3,'active',95,16,40)]};
describe('swim split charts',()=>{
 it('charts the active lengths only and keeps pace, SWOLF and strokes on separate synchronized axes',()=>{
   const chart=swimLengthChartOptions(base) as any;
   expect(chart.xAxis[0].data).toEqual(['1','3']);
   expect(chart.series.map((s:any)=>s.id)).toEqual(['pace','swolf','strokes']);
   expect(chart.series[0].data).toEqual([100,95]);
   expect(chart.series[1].data).toEqual([42,40]);
   expect(chart.yAxis.map((y:any)=>y.inverse)).toEqual([true,false,false]);
   expect(chart.yAxis.map((y:any)=>y.nameLocation)).toEqual(['start','end','end']);
   expect(chart.yAxis.every((y:any)=>y.nameTextStyle.align==='left')).toBe(true);
   expect(chart.dataZoom.every((z:any)=>z.xAxisIndex.length===3)).toBe(true);
   expect(swimLengthChartHeight(base)).toBe(535);
 });
 it('preserves fractional split seconds while formatting pace independently',()=>{
   expect(swimSplitTime(23.625)).toBe('0:23.625');
   expect(swimSplitTime(28.125)).toBe('0:28.125');
   expect(swimSplitTime(59.9999)).toBe('1:00');
   expect(swimSplitTime(62.05)).toBe('1:02.05');
   expect(swimSplitTime(null)).toBe('—');
 });
 it('keeps all 41 synthetic active lengths, leaves missing metrics as gaps and never plots rests',()=>{
   const lengths=Array.from({length:41},(_,i)=>row(i+1,'active',94.5+i,12,35.625+i));
   lengths[20]!.swolf=null;
   const chart=swimLengthChartOptions({...base,lengths:[...lengths,row(42,'rest',null,null,null)]}) as any;
   expect(chart.xAxis[0].data).toHaveLength(41);
   expect(chart.xAxis[0].data.at(-1)).toBe('41');
   expect(chart.series[0].data[0]).toBe(94.5);
   expect(chart.series[0].tooltip.valueFormatter(94.5)).toBe('1:35');
   expect(chart.series[1].data[20]).toBeNull();
   expect(chart.series.every((s:any)=>s.connectNulls===false)).toBe(true);
 });
 it('omits charts entirely when there is no recorded split evidence',()=>{
   expect(swimLengthChartOptions({...base,lengths:[row(1,'rest',null,null,null)]})).toBeNull();
   expect(swimLengthChartOptions({...base,lengths:[row(1,'active',null,null,null)]})).toBeNull();
 });
});
