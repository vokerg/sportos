import {isCalendarDate} from '../ui/format.mjs';
const fail=()=>{throw new Error('Invalid performance response.');};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const count=v=>Number.isSafeInteger(v)&&v>=0;
export const TARGETS=[5000,10000,15000,20000,21097.5,25000,42195];
export function leaderboardPath({distanceM=5000,from='',to='',offset=0}={}){
 if(!TARGETS.includes(distanceM)||!count(offset)||offset>100000||(from&&!isCalendarDate(from))||(to&&!isCalendarDate(to))||(from&&to&&from>to))return fail();
 const q=new URLSearchParams({distanceM:String(distanceM),limit:'20',offset:String(offset)});
 if(from)q.set('from',from);if(to)q.set('to',to);
 return '/performance/leaderboard?'+q;
}
export function projectLeaderboard(raw){
 if(!raw||!TARGETS.includes(raw.targetDistanceM)||!Array.isArray(raw.rows)||raw.rows.length>20||!count(raw.total)||!count(raw.offset)||!count(raw.limit)||raw.limit<1||raw.limit>200)return fail();
 const coverage={};
 for(const k of ['eligibleRuns','measuredCurrent','legacyLinked','legacyUnmatched','legacyAmbiguous','estimatedOnly','missingRichDetail','unprocessed','staleOrFailed','unavailable']){
  if(!count(raw.coverage?.[k]))return fail();coverage[k]=raw.coverage[k];
 }
 const rows=raw.rows.map(r=>{
  if(typeof r.id!=='string'||r.id.length>150||!isCalendarDate(r.date)||!positive(r.durationS)||!count(r.rank)||r.rank<1||!['excel','strava','garmin'].includes(r.source)||!['historical_excel','moving_flags','timer_events'].includes(r.pausePolicy)
    ||(r.activityId!==null&&!uuid(r.activityId))||(r.eventId!==null&&!uuid(r.eventId))||!count(r.alternativeCount)||!Array.isArray(r.alternatives)||r.alternatives.length>20)return fail();
  return {id:r.id,date:r.date,durationS:r.durationS,rank:r.rank,source:r.source,pausePolicy:r.pausePolicy,activityId:r.activityId,eventId:r.eventId,alternativeCount:r.alternativeCount,
   alternatives:r.alternatives.map(a=>{if(!positive(a.durationS)||!['excel','strava','garmin'].includes(a.source)||(a.eventId!==null&&!uuid(a.eventId)))return fail();return {source:a.source,durationS:a.durationS,eventId:a.eventId};})};
 });
 return {targetDistanceM:raw.targetDistanceM,total:raw.total,offset:raw.offset,limit:raw.limit,coverage,rows};
}
export function projectEvent(raw){
 if(!raw||!uuid(raw.id)||!isCalendarDate(raw.eventDate)||!positive(raw.distanceM)||!positive(raw.durationS)||!positive(raw.paceSPerKm)||(raw.activityId!==null&&!uuid(raw.activityId))||!['manual','run_db_xlsx','strava','garmin','fit'].includes(raw.source))return fail();
 return {id:raw.id,date:raw.eventDate,distanceM:raw.distanceM,durationS:raw.durationS,paceSPerKm:raw.paceSPerKm,source:raw.source,activityId:raw.activityId,isTreadmill:raw.isTreadmill===true,
   provenance:raw.provenance?.status==='available'?'Retained original evidence':'Original evidence unavailable',
   reconciliation:raw.reconciliation?.status==='accepted'?'Linked to a canonical run':raw.reconciliation?.status==='ambiguous'?'Ambiguous run association':'Historical record'};
}
