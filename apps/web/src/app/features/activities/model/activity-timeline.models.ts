import type { EChartsCoreOption } from 'echarts/core';
export type TimelineSource = 'strava' | 'garmin';
export interface TimelineMetric { key: string; label: string; unit: string; points: [number, number | null][]; }
export interface ActivityTimeline {
  source: TimelineSource; status: 'available' | 'unavailable'; reason?: string;
  durationS: number; sampleCount: number; simplified: boolean; metrics: TimelineMetric[];
}
export function timelineTime(seconds: number) {
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}` : `${m}:${String(s % 60).padStart(2,'0')}`;
}
export function timelineValue(value: unknown, metric: TimelineMetric) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return metric.key === 'pace' ? `${timelineTime(value * 60)} /km` : `${Number(value.toFixed(metric.key === 'distance' ? 2 : 1))} ${metric.unit}`;
}
const colors = ['#2563eb','#e44763','#8756cf','#159888','#c18420','#667085','#d25c31','#3a869c','#bd5798','#677434'];
export function timelineOptions(data: ActivityTimeline, metrics: TimelineMetric[]): EChartsCoreOption {
  return {
    animation: false,
    grid: metrics.map((_,i) => ({left:70, right:24, top:30 + i*170, height:120})),
    axisPointer: { link: [{xAxisIndex:'all'}] },
    tooltip: { trigger:'axis', confine:true, axisPointer:{type:'line'},
      formatter: (raw: {seriesIndex:number; data:[number,number|null]} | {seriesIndex:number; data:[number,number|null]}[]) => {
        const items = Array.isArray(raw) ? raw : [raw];
        return items.map((item,i) => `${i === 0 ? timelineTime(item.data[0]) + '<br/>' : ''}${metrics[item.seriesIndex]!.label}: ${timelineValue(item.data[1],metrics[item.seriesIndex]!)}`).join('<br/>');
      },
    },
    xAxis: metrics.map((_,i) => ({ type:'value', gridIndex:i, min:0, max:data.durationS,
      axisLabel:{show:i===metrics.length-1, formatter:(v:number) => timelineTime(v)},
      axisPointer:{label:{formatter:(p:{value:number}) => timelineTime(p.value)}},
      splitLine:{show:false}, name:i===metrics.length-1 ? 'Elapsed time' : '', nameLocation:'middle', nameGap:30 })),
    yAxis: metrics.map((metric,i) => ({type:'value', gridIndex:i, scale:true, inverse:metric.key==='pace',
      name:`${metric.label} · ${metric.unit}`, nameLocation:metric.key==='pace' ? 'start' : 'end', nameTextStyle:{align:'left',color:colors[data.metrics.indexOf(metric)%colors.length],fontWeight:600},
      axisLabel:{formatter:(v:number) => metric.key==='pace' ? timelineTime(v*60) : String(Number(v.toFixed(1)))}, splitNumber:3,
      splitLine:{lineStyle:{color:'#edf0f5'}}})),
    dataZoom: [{type:'inside', xAxisIndex:metrics.map((_,i)=>i), filterMode:'none'},
      {type:'slider',xAxisIndex:metrics.map((_,i)=>i),bottom:0,height:18,showDetail:false,filterMode:'none'}],
    series: metrics.map((metric,i) => ({id:metric.key,name:metric.label,type:'line',xAxisIndex:i,yAxisIndex:i,
      data:metric.points,showSymbol:false,connectNulls:false,smooth:false,
      lineStyle:{width:1.5,color:colors[data.metrics.indexOf(metric)%colors.length]},itemStyle:{color:colors[data.metrics.indexOf(metric)%colors.length]},
      tooltip:{valueFormatter:(value:unknown) => timelineValue(value,metric)}})),
  };
}
const reasons: Record<string,string> = {
  not_linked:'This activity has no linked source for this provider.', not_retained:'No timeline is retained. Use Fetch detail in Provider data below, then reload the graph.',
  not_recorded:'The provider did not supply streams for this activity.', stale:'The retained streams belong to an older activity version. Refresh detail below, then reload the graph.',
  incomplete_resources:'The retained FIT resources are incomplete. Refresh Garmin detail below, then reload the graph.',
  sample_limit_or_missing:'Samples are missing or exceed the 150,000-sample display limit.',
  invalid_timeline:'Recorded timestamps are invalid, duplicated, out of order or exceed seven days.',
  no_supported_metrics:'No supported recorded metrics are available in this timeline.',
};
export function timelineReason(reason?:string) { return reasons[reason ?? ''] ?? 'No supported timeline is available.'; }
