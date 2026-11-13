export interface CalculationJob {
 id:string;from:string;to:string;nextDate:string;processedDays:number;totalDays:number;
 status:'queued'|'running'|'succeeded'|'failed'|'cancelled';errorCode:string|null;attemptCount:number;
}
export interface CalculationState {
 cursor:{startDate:string;completedThrough:string|null;timeZone:string};nextDate:string;
 activeJob:CalculationJob|null;latestJob:CalculationJob|null;
}
export const calculationActive=(job:CalculationJob|null)=>!!job&&(job.status==='queued'||job.status==='running');
function record(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid calculation response');return value as Record<string,unknown>}
function date(value:unknown):string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new Error('Invalid calculation date');return value}
export function calculationJob(value:unknown):CalculationJob {
 const r=record(value);
 if(typeof r.id!=='string'||!/^[0-9a-f-]{36}$/i.test(r.id)||!['queued','running','succeeded','failed','cancelled'].includes(String(r.status)))throw new Error('Invalid calculation job');
 for(const field of ['processedDays','totalDays','attemptCount'])if(!Number.isSafeInteger(r[field])||Number(r[field])<0)throw new Error('Invalid calculation progress');
 if(Number(r.totalDays)<1||Number(r.totalDays)>3661||Number(r.processedDays)>Number(r.totalDays)||Number(r.attemptCount)>3||!(r.errorCode===null||['DAILY_DATA_UNAVAILABLE','DAILY_RECALCULATION_FAILED','RETRY_EXHAUSTED'].includes(String(r.errorCode))))throw new Error('Invalid calculation progress');
 return {id:r.id,from:date(r.from),to:date(r.to),nextDate:date(r.nextDate),processedDays:Number(r.processedDays),totalDays:Number(r.totalDays),attemptCount:Number(r.attemptCount),status:r.status as CalculationJob['status'],errorCode:r.errorCode as string|null};
}
export function calculationState(value:unknown):CalculationState {
 const r=record(value),cursor=record(r.cursor);
 if(typeof cursor.timeZone!=='string'||cursor.timeZone.length>100)throw new Error('Invalid calculation calendar');
 return {cursor:{startDate:date(cursor.startDate),completedThrough:cursor.completedThrough===null?null:date(cursor.completedThrough),timeZone:cursor.timeZone},nextDate:date(r.nextDate),activeJob:r.activeJob===null?null:calculationJob(r.activeJob),latestJob:r.latestJob===null?null:calculationJob(r.latestJob)};
}
