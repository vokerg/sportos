import {isCalendarDate} from '../ui/format.mjs';
export const METRICS=['score','steps','run','bike','swim','workout','bonus'];
export const WINDOWS=[7,20,30,60,365];
const CATEGORIES=['steps','run','bike','swim','workout','rowing','sup','hiit','bonus','unattributed'];
const fail=()=>{throw new Error('Invalid canonical analytics response.');};
const number=v=>v===null?null:typeof v==='number'&&Number.isFinite(v)?v:fail();
const count=v=>Number.isSafeInteger(v)&&v>=0?v:fail();
const date=v=>isCalendarDate(v)?v:fail();
export function analyticsPath({mode,from,to,metric='score',window=30}){
 if(!['monthly','rolling'].includes(mode)||!METRICS.includes(metric)||!WINDOWS.includes(window)||!isCalendarDate(from)||!isCalendarDate(to)||from>to)return fail();
 const q=new URLSearchParams({from,to});
 if(mode==='monthly'){q.set('granularity','monthly');q.set('metrics',METRICS.join(','));}
 else{q.set('metric',metric);q.set('windows',String(window));}
 return '/dynamics/'+mode+'?'+q;
}
export function projectMonthly(raw){
 if(!Array.isArray(raw?.monthly)||raw.monthly.length>121)return fail();
 return raw.monthly.map(b=>{
  if(typeof b.key!=='string'||!/^\d{4}-\d{2}$/.test(b.key)||typeof b.partial!=='boolean')return fail();
  const values={},distances={},contributions={};
  for(const m of METRICS){const v=b.values?.[m];if(!v)return fail();values[m]={total:number(v.total),average:number(v.recordedDayAverage)};}
  for(const m of ['run','bike','swim'])if(b.distanceTotals?.[m]!==undefined)distances[m]=number(b.distanceTotals[m]);
  for(const c of CATEGORIES)if(b.scoreContributions?.[c]!==undefined)contributions[c]=number(b.scoreContributions[c]);
  return {key:b.key,from:date(b.from),to:date(b.to),calendarDays:count(b.calendarDays),recordedDays:count(b.recordedDays),partial:b.partial,values,distances,contributions};
 });
}
export function projectRolling(raw,metric,window){
 if(raw?.metric!==metric||!METRICS.includes(metric)||!['points','steps','metres'].includes(raw.unit)||!Array.isArray(raw.points)||raw.points.length>3660||!Array.isArray(raw.windows)||!raw.windows.includes(window))return fail();
 const points=raw.points.map(p=>{
  const w=p.windows?.[window];if(!w||typeof w.complete!=='boolean'||w.windowDays!==window)return fail();
  return {date:date(p.date),dailyValue:number(p.dailyValue),total:number(w.total),average:number(w.calendarDayAverage),activeDays:number(w.activeDays),recordedDays:count(w.recordedDays),windowDays:count(w.windowDays),complete:w.complete};
 });
 const contributionPoints=raw.scoreContributions?.[window]?.points??[];
 if(!Array.isArray(contributionPoints)||contributionPoints.length>3660)return fail();
 const contributions=contributionPoints.map(p=>{const values={};for(const c of CATEGORIES)if(p.contributions?.[c]!==undefined)values[c]=number(p.contributions[c]);return {date:date(p.date),total:number(p.total),values};});
 return {metric,unit:raw.unit,points,contributions};
}
/** Pixel projection only: no rolling/statistical/scoring calculations. Null gaps stay disconnected. */
export function chartSegments(values,width=300,height=150){
 const finite=values.filter(v=>v!==null&&Number.isFinite(v));
 const min=Math.min(0,...finite), max=Math.max(1,...finite), span=max-min;
 const segments=[];let current=[];
 values.forEach((v,i)=>{if(v===null){if(current.length)segments.push(current);current=[];}else{
  if(!Number.isFinite(v))return fail();
  current.push({x:8+i/Math.max(1,values.length-1)*(width-16),y:8+(max-v)/span*(height-16),index:i});
 }});
 if(current.length)segments.push(current);
 return segments;
}
