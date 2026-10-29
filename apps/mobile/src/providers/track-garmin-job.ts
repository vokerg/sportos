import {pollDelay,type OperationScope} from './use-operation';
import {garminJob,activeGarminJob,type GarminFetchJob,type GarminTarget} from './garmin-jobs';
export async function trackGarminJob(api:OperationScope,initial:GarminFetchJob,target:GarminTarget,progress:(job:GarminFetchJob)=>void){
 let job=initial;
 for(let i=0;;i++){
  if(api.signal.aborted)throw new Error('Cancelled');progress(job);
  if(!activeGarminJob(job)||i===24)return job;
  await pollDelay(api.signal);const next=garminJob(await api.read('/garmin/jobs/'+job.id),target);if(next.id!==job.id)throw new Error('Unexpected Garmin job');job=next;
 }
}
