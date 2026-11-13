export interface DailyCalculationJob {
 id:string;from:string;to:string;nextDate:string;processedDays:number;totalDays:number;
 status:'queued'|'running'|'succeeded'|'failed'|'cancelled';errorCode:string|null;attemptCount:number;
}
export interface DailyCalculationState {
 cursor:{startDate:string;completedThrough:string|null;timeZone:string};nextDate:string;
 activeJob:DailyCalculationJob|null;latestJob:DailyCalculationJob|null;
}
export const calculationActive=(job:DailyCalculationJob|null)=>!!job&&(job.status==='queued'||job.status==='running');
export const calculationTerminal=(job:DailyCalculationJob)=>!calculationActive(job);
export function calculationMessage(job:DailyCalculationJob){
 if(job.status==='failed')return job.errorCode==='DAILY_DATA_UNAVAILABLE'?'Retain source evidence for '+job.nextDate+', then retry. This day has not been skipped.':'Calculation failed. Earlier completed days are saved; retry from the checkpoint.';
 if(job.status==='cancelled')return 'Calculation cancelled. Earlier completed days are saved.';
 if(job.status==='succeeded')return 'Scores updated. Today remains provisional and will be calculated again on the next click.';
 return 'Calculating retained evidence. You can leave this page; the worker continues.';
}
