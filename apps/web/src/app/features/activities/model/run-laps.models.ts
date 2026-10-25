import type { EChartsCoreOption } from 'echarts/core';
import type { ActivityProviderDetailResponse, GarminDetail } from '../activities-api.service';
import { formatDurationClock } from '../../../shared/util/duration';
export type LapSource = 'strava' | 'garmin';
export interface RunLap {
  row: number; distanceM: number | null; durationS: number | null;
  durationBasis: 'moving' | 'timer' | 'elapsed' | null;
  elapsedS: number | null; paceSPerKm: number | null; heartRate: number | null;
}
export interface RunLaps { rows: RunLap[]; bounded: boolean }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const numeric = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
/** Keep provider order and partial/rest laps. Never derive splits from totals or streams. */
export function runLaps(source: LapSource, strava: ActivityProviderDetailResponse | null, garmin: GarminDetail | null): RunLaps {
  const resource = strava?.resources['laps'];
  const raw = source === 'strava' ? resource?.availability === 'available' && Array.isArray(resource.payload) ? resource.payload : [] : garmin?.laps ?? [];
  const limit = source === 'garmin' ? 100 : 1000;
  const rows: RunLap[] = [];
  for (const [index, lap] of raw.slice(0, limit).entries()) {
    if (!object(lap) || (source === 'garmin' && lap['message'] !== 'lap')) continue;
    const fields = new Map<string, { value: unknown; units: unknown }>();
    const seen = new Set<string>();
    if (source === 'garmin' && Array.isArray(lap['fields'])) for (const field of lap['fields']) {
      if (!object(field) || typeof field['name'] !== 'string' || field['developerIndex'] != null) continue;
      if (seen.has(field['name'])) { fields.delete(field['name']); continue; }
      seen.add(field['name']); fields.set(field['name'], { value: field['value'], units: field['units'] });
    }
    const value = (name: string, unit: string, max: number) => {
      if (source === 'strava') return numeric(lap[name], max);
      const field = fields.get(name);
      return field?.units === unit ? numeric(field.value, max) : null;
    };
    const distanceM = value(source === 'strava' ? 'distance' : 'total_distance', 'm', 1_000_000);
    const elapsedS = value(source === 'strava' ? 'elapsed_time' : 'total_elapsed_time', 's', 604800);
    const active = value(source === 'strava' ? 'moving_time' : 'total_timer_time', 's', 604800);
    const durationS = active ?? elapsedS;
    const durationBasis = active !== null ? source === 'strava' ? 'moving' : 'timer' : elapsedS !== null ? 'elapsed' : null;
    const heartRate = value(source === 'strava' ? 'average_heartrate' : 'avg_heart_rate', 'bpm', 300);
    rows.push({row: index + 1, distanceM, durationS, durationBasis, elapsedS,
      paceSPerKm: distanceM !== null && distanceM > 0 && durationS !== null && durationS > 0 ? durationS * 1000 / distanceM : null,
      heartRate: heartRate !== null && heartRate > 0 ? heartRate : null});
  }
  return {rows, bounded: raw.length >= limit};
}
export function runLapChart(data: RunLaps): { options: EChartsCoreOption; height: number } | null {
  const metrics = [
    {id:'pace', name:'Pace · /km', values:data.rows.map(row=>row.paceSPerKm)},
    {id:'hr', name:'Heart rate · bpm', values:data.rows.map(row=>row.heartRate)},
  ].filter(metric=>metric.values.some(value=>value!==null));
  if (!metrics.length) return null;
  return { height: metrics.length * 155 + 70, options: {
    animation:false,
    grid:metrics.map((_,i)=>({left:75,right:25,top:36+155*i,height:100})),
    axisPointer:{link:[{xAxisIndex:'all'}]}, tooltip:{trigger:'axis',confine:true},
    xAxis:metrics.map((_,i)=>({type:'category',gridIndex:i,data:data.rows.map(row=>String(row.row)),axisLabel:{show:i===metrics.length-1},name:i===metrics.length-1?'Recorded lap #':'',nameLocation:'middle',nameGap:28})),
    yAxis:metrics.map((metric,i)=>({type:'value',gridIndex:i,scale:true,inverse:metric.id==='pace',name:metric.name,nameLocation:metric.id==='pace'?'start':'end',nameTextStyle:{align:'left'},splitNumber:3,axisLabel:{formatter:(value:number)=>metric.id==='pace'?formatDurationClock(value):String(value)}})),
    dataZoom:[{type:'inside',xAxisIndex:metrics.map((_,i)=>i),filterMode:'none'},{type:'slider',xAxisIndex:metrics.map((_,i)=>i),bottom:0,height:16,filterMode:'none'}],
    series:metrics.map((metric,i)=>({id:metric.id,name:metric.name,type:'line',xAxisIndex:i,yAxisIndex:i,data:metric.values,showSymbol:data.rows.length<80,connectNulls:false,smooth:false,tooltip:{valueFormatter:(value:unknown)=>typeof value==='number'?metric.id==='pace'?formatDurationClock(value):String(Number(value.toFixed(1))):'—'}})),
  }};
}
