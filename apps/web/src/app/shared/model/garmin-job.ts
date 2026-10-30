/** Public owner-scoped job metadata. No credentials, sources or lease internals. */
export interface GarminFetchJob {
 id:string;operation:'day'|'activity';date:string|null;activityId:string|null;refresh:boolean;
 status:'queued'|'running'|'succeeded'|'failed'|'cancelled';phase:string;attemptCount:number;errorCode:string|null;
}
export const activeGarminJob=(job:GarminFetchJob|null|undefined)=>job?.status==='queued'||job?.status==='running';
export const terminalGarminJob=(job:GarminFetchJob)=>!activeGarminJob(job);
export function garminJobMessage(job:GarminFetchJob):string{
 if(job.status==='succeeded')return 'Garmin updated. Use Recalculate to update daily totals and score.';
 if(job.status==='cancelled')return 'Garmin request cancelled. Previously retained evidence is safe.';
 if(job.errorCode==='GARMIN_REAUTHORIZATION_REQUIRED')return 'Reconnect Garmin to try again.';
 if(job.status==='failed')return 'Garmin could not finish. Successful evidence was retained; retry is available.';
 if(job.phase==='rate_limited')return 'Waiting for Garmin’s rate limit. The worker will resume automatically.';
 return job.status==='queued'?'Garmin request queued for the worker.':'The worker is fetching and retaining Garmin evidence…';
}
