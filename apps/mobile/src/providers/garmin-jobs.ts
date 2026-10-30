export interface GarminFetchJob{id:string;operation:'day'|'activity';date:string|null;activityId:string|null;refresh:boolean;status:'queued'|'running'|'succeeded'|'failed'|'cancelled';phase:string;attemptCount:number;errorCode:string|null}
export type GarminTarget={operation:'day';date:string}|{operation:'activity';activityId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const activeGarminJob=(job:GarminFetchJob|null|undefined)=>job?.status==='queued'||job?.status==='running';
export function garminJob(raw:unknown,target:GarminTarget):GarminFetchJob{
 if(!raw||typeof raw!=='object')throw new Error('Invalid Garmin job');const r=raw as Record<string,unknown>;
 if(typeof r.id!=='string'||!uuid.test(r.id)||r.operation!==target.operation||(target.operation==='day'?r.date!==target.date||r.activityId!==null:r.activityId!==target.activityId||r.date!==null)||!['queued','running','succeeded','failed','cancelled'].includes(String(r.status))||typeof r.phase!=='string'||!/^[a-z_]{1,50}$/.test(r.phase)||typeof r.refresh!=='boolean'||typeof r.attemptCount!=='number'||!Number.isInteger(r.attemptCount)||r.attemptCount<0||r.attemptCount>5||(r.errorCode!==null&&(typeof r.errorCode!=='string'||!/^[A-Z_]{1,80}$/.test(r.errorCode))))throw new Error('Invalid Garmin job');
 return {id:r.id,operation:target.operation,date:target.operation==='day'?target.date:null,activityId:target.operation==='activity'?target.activityId:null,refresh:r.refresh,status:r.status as GarminFetchJob['status'],phase:r.phase,attemptCount:r.attemptCount,errorCode:r.errorCode as string|null};
}
export function garminJobMessage(job:GarminFetchJob){
 if(job.status==='succeeded')return 'Garmin updated. Your score stays unchanged.';
 if(job.status==='cancelled')return 'Garmin request cancelled. Saved evidence is safe.';
 if(job.errorCode==='GARMIN_REAUTHORIZATION_REQUIRED')return 'Reconnect Garmin to try again.';
 if(job.status==='failed')return 'Garmin could not finish. Saved evidence is safe; retry is available.';
 if(job.phase==='rate_limited')return 'Waiting for Garmin’s rate limit. The worker will resume automatically.';
 return job.status==='queued'?'Waiting for the Garmin worker…':'The worker is updating Garmin evidence…';
}
