import type { EChartsCoreOption } from 'echarts/core';
import type { SwimLengthResponse } from '../activities-api.service';
import { formatDurationClock } from '../../../shared/util/duration';

/** Native FIT lengths, not Garmin lap aggregates; no inferred/missing values. */
export function swimLengthChartOptions(data: SwimLengthResponse): EChartsCoreOption | null {
  const active = data.lengths.filter(length => length.kind === 'active');
  if (!active.length || !active.some(row => row.paceSPer100M !== null || row.swolf !== null || row.strokes !== null)) return null;
  const labels = active.map(row => String(row.lengthNumber ?? row.row));
  const metrics = [
    {key: 'pace', title:'Pace · /100 m', values:active.map(row => row.paceSPer100M), formatter:(v:number)=>formatDurationClock(v)},
    {key: 'swolf', title:'SWOLF · timer seconds + strokes', values:active.map(row => row.swolf), formatter:(v:number)=>String(Number(v.toFixed(1)))},
    {key: 'strokes', title:'Strokes · per length', values:active.map(row => row.strokes), formatter:(v:number)=>String(v)},
  ].filter(metric => metric.values.some(value => value !== null));
  if (!metrics.length) return null;
  return {
    animation: false,
    grid: metrics.map((_,i) => ({left:75,right:25,top:36 + 155*i,height:100})),
    axisPointer: {link:[{xAxisIndex:'all'}]},
    tooltip: {trigger:'axis',confine:true},
    xAxis: metrics.map((_,i) => ({type:'category',gridIndex:i,data:labels,
      axisLabel:{show:i===metrics.length-1},name:i===metrics.length-1?'Active pool length #':'',
      nameLocation:'middle',nameGap:28})),
    yAxis: metrics.map((metric,i) => ({type:'value',gridIndex:i,scale:true,
      inverse:metric.key==='pace',name:metric.title,nameLocation:'end',
      axisLabel:{formatter:metric.key==='pace'?(v:number)=>formatDurationClock(v):(v:number)=>String(v)},
      splitLine:{show:true}})),
    dataZoom: [{type:'inside',xAxisIndex:metrics.map((_,i)=>i),filterMode:'none'},
      {type:'slider',xAxisIndex:metrics.map((_,i)=>i),bottom:0,height:16,filterMode:'none'}],
    series: metrics.map((metric,i) => ({
      id:metric.key,name:metric.title,type:'line',xAxisIndex:i,yAxisIndex:i,
      data:metric.values,showSymbol:active.length<80,connectNulls:false,smooth:false,
      tooltip:{valueFormatter:(value:unknown) => typeof value==='number'?metric.formatter(value):'—'},
    })),
  };
}
export function swimLengthChartHeight(data: SwimLengthResponse) {
  const series = swimLengthChartOptions(data)?.series;
  return Array.isArray(series) ? series.length * 155 + 70 : 0;
}
