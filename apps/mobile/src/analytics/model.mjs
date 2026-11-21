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
 const dayNumber=s=>{const [y,m,d]=s.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;};
 if(dayNumber(to)-dayNumber(from)+1>(mode==='rolling'?366:3660))return fail();
 const q=new URLSearchParams({from,to});
 if(mode==='monthly'){q.set('granularity','monthly');q.set('metrics',METRICS.join(','));}
 else{q.set('metric',metric);q.set('windows',String(window));}
 return '/dynamics/'+mode+'?'+q;
}
export function projectMonthly(raw){
 if(!Array.isArray(raw?.monthly)||raw.monthly.length>121)return fail();
 return raw.monthly.map(b=>{
  if(typeof b.key!=='string'||!/^\d{4}-\d{2}$/.test(b.key)||typeof b.partial!=='boolean')return fail();
  if(count(b.recordedDays)>count(b.calendarDays))return fail();
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
  const w=p.windows?.[window];if(!w||typeof w.complete!=='boolean'||w.windowDays!==window||count(w.recordedDays)>window)return fail();
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


export function historyPath(to){
 if(!isCalendarDate(to)||to<'1900-01-01'||to>'2100-12-31')return fail();
 return '/dynamics/history?'+new URLSearchParams({to});
}
/** Validate the columnar server output; rolling values/records are server calculations. */
export function projectHistory(raw,metric,window){
 if(raw?.version!==1||!METRICS.includes(metric)||!WINDOWS.includes(window)||!Array.isArray(raw.dates)||raw.dates.length>73414||!Array.isArray(raw.records)||raw.records.length>20000)return fail();
 const dates=raw.dates.map(date);
 if(dates.some((d,i)=>i>0&&d<=dates[i-1]))return fail();
 const length=dates.length;
 const col=v=>{if(!Array.isArray(v)||v.length!==length)return fail();return v.map(number);};
 const daily=col(raw.daily?.[metric]);
 const values=raw.windows?.[window];
 if(length&&!values)return fail();
 const totals=col(values?.totals?.[metric]??[]),active=col(values?.activeDays?.[metric]??[]);
 const recorded=col(values?.recordedDays??[]);
 const records=raw.records.map(r=>{
  if(!METRICS.includes(r.metric)||![1,...WINDOWS].includes(r.windowDays)||!(r.period==='all'||/^\d{4}$/.test(r.period))||typeof r.value!=='number'||!Number.isFinite(r.value)||count(r.recordedDays)>r.windowDays)return fail();
  return {metric:r.metric,windowDays:r.windowDays,period:r.period,date:date(r.date),value:r.value,recordedDays:r.recordedDays};
 });
 const points=dates.map((d,i)=>{
  if(count(recorded[i])>window||active[i]!==null&&(count(active[i])>recorded[i]))return fail();
  return {date:d,dailyValue:daily[i],total:totals[i],average:totals[i]===null?null:totals[i]/window,activeDays:active[i],recordedDays:recorded[i],windowDays:window,complete:recorded[i]===window};
 });
 // Reuse existing contribution validation rather than trusting provider-shaped objects.
 const rolling=projectRolling({metric,unit:['run','bike','swim'].includes(metric)?'metres':metric==='steps'?'steps':'points',windows:[window],points:[],scoreContributions:{}},metric,window);
 const contribution=raw.scoreContributions?.[window]?.points??[];
 if(!Array.isArray(contribution)||contribution.length>73414)return fail();
 rolling.contributions=contribution.map(p=>{const values={};for(const c of CATEGORIES)if(p.contributions?.[c]!==undefined)values[c]=number(p.contributions[c]);return {date:date(p.date),total:number(p.total),values};});
 return {...rolling,points,records};
}

/** Local viewport indices only; exact numeric series remains the server's output. */
export function changeViewport(dates,range,current,action){
 let start=current?.start??Math.max(0,dates.findIndex(d=>d>=range.from));
 let end=current?.end??dates.length;
 if(!current)while(end>0&&dates[end-1]>range.to)end--;
 if(action==='all')return {start:0,end:dates.length};
 const size=Math.max(1,end-start);
 if(action==='in'){const trim=Math.floor(size/4);return {start:start+trim,end:Math.max(start+1,end-trim)};}
 if(action==='out'){const extra=Math.max(15,Math.floor(size/2));return {start:Math.max(0,start-extra),end:Math.min(dates.length,end+extra)};}
 const next=Math.max(0,Math.min(dates.length-size,start+(action==='earlier'?-1:1)*Math.max(1,Math.floor(size/2))));
 return {start:next,end:Math.min(dates.length,next+size)};
}
