import { describe, expect, it } from 'vitest';
import { swimLengthChartOptions, swimLengthChartHeight } from './swim-length-chart.models';
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
   expect(chart.dataZoom.every((z:any)=>z.xAxisIndex.length===3)).toBe(true);
   expect(swimLengthChartHeight(base)).toBe(535);
 });
 it('omits charts entirely when there is no recorded split evidence',()=>{
   expect(swimLengthChartOptions({...base,lengths:[row(1,'rest',null,null,null)]})).toBeNull();
   expect(swimLengthChartOptions({...base,lengths:[row(1,'active',null,null,null)]})).toBeNull();
 });
});
