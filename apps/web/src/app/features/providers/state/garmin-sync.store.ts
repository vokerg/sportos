import {computed,Injectable,OnDestroy,signal} from '@angular/core';
import {Subscription,of} from 'rxjs';
import {pollDurableJob} from '../../../core/jobs/durable-job-poller';
import {activeGarminJob,terminalGarminJob,garminJobMessage,type GarminFetchJob} from '../../../shared/model/garmin-job';
import {GarminSyncApiService,type GarminConnectionStatus} from '../data-access/garmin-sync-api.service';
@Injectable()
export class GarminSyncStore implements OnDestroy {
 readonly connection=signal<GarminConnectionStatus|null>(null);readonly job=signal<GarminFetchJob|null>(null);
 readonly loading=signal(false);readonly working=signal(false);readonly error=signal('');
 readonly message=computed(()=>{
  const job=this.job();
  return job?garminJobMessage(job):'';
 });
 private generation=0;private read?:Subscription;private action?:Subscription;private poll?:Subscription;private completed:()=>void=()=>{};
 private ambiguous=false;
 constructor(private readonly api:GarminSyncApiService){}
 initialize(completed:()=>void=()=>{}){this.completed=completed;this.load()}
 ngOnDestroy(){this.generation++;this.read?.unsubscribe();this.action?.unsubscribe();this.poll?.unsubscribe()}
 load(){
  this.generation++;const generation=this.generation;this.read?.unsubscribe();this.action?.unsubscribe();this.poll?.unsubscribe();
  this.loading.set(true);this.working.set(false);this.error.set('');
  this.read=this.api.connection().subscribe({next:status=>{if(generation!==this.generation)return;this.connection.set(status);this.loading.set(false);this.ambiguous=false;
   if(status.activeJob){this.job.set(status.activeJob);this.check()}else if(activeGarminJob(this.job()))this.job.set(null);
  },error:()=>{if(generation===this.generation){this.loading.set(false);this.error.set('Could not check Garmin. Check status before starting another sync.')}}});
 }
 sync(){
  if(this.loading()||this.working()||!this.connection()?.enabled||activeGarminJob(this.job()))return;
  if(this.ambiguous){this.load();return;}
  this.submit(()=>this.api.sync());
 }
 retry(){const job=this.job();if(!job||this.working()||activeGarminJob(job))return;this.submit(()=>this.api.retry(job.id))}
 cancel(){const job=this.job();if(!job||this.working()||!activeGarminJob(job))return;this.submit(()=>this.api.cancel(job.id))}
 private submit(request:()=>ReturnType<GarminSyncApiService['sync']>){
  this.generation++;const generation=this.generation;this.read?.unsubscribe();this.poll?.unsubscribe();this.action?.unsubscribe();this.working.set(true);this.error.set('');
  this.action=request().subscribe({next:job=>{if(generation!==this.generation)return;this.working.set(false);this.job.set(job);this.check()},error:()=>{if(generation===this.generation){this.working.set(false);this.ambiguous=true;this.error.set('Could not confirm the Garmin request. Check status before trying again.')}}});
 }
 check(){
  const job=this.job();if(!job){this.load();return;}
  this.poll?.unsubscribe();this.error.set('');const generation=this.generation;
  this.poll=(terminalGarminJob(job)?of({state:'terminal' as const,job,attempt:0}):pollDurableJob(()=>this.api.job(job.id),{intervalMs:3000,maxAttempts:200,maxDurationMs:600000,isTerminal:terminalGarminJob})).subscribe(event=>{
   if(generation!==this.generation)return;
   if(event.job){if(event.job.id!==job.id){this.error.set('Unexpected Garmin job response. Reload status.');return;}this.job.set(event.job)}
   if(event.state==='terminal'){
    if(event.job?.status==='succeeded')this.completed();
    this.read?.unsubscribe();this.read=this.api.connection().subscribe({next:status=>{if(generation===this.generation)this.connection.set(status)},error:()=>{if(generation===this.generation)this.error.set('Could not refresh Garmin status after the job finished.')}});
   }else if(event.state==='error'||event.state==='exhausted')this.error.set('Automatic Garmin status checks paused.');
  });
 }
 refreshStatus(){
  if(!this.ambiguous&&activeGarminJob(this.job()))this.check();
  else this.load();
 }
 readonly active=()=>activeGarminJob(this.job());
}
