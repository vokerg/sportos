import {Injectable,OnDestroy,signal} from '@angular/core';
import {of,Subscription} from 'rxjs';
import {pollDurableJob} from '../../../core/jobs/durable-job-poller';
import {DailyCalculationApiService} from '../data-access/daily-calculation-api.service';
import {calculationActive,calculationTerminal,calculationMessage,type DailyCalculationJob,type DailyCalculationState} from '../model/daily-calculation.models';

@Injectable()
export class DailyCalculationStore implements OnDestroy {
 readonly state=signal<DailyCalculationState|null>(null);readonly job=signal<DailyCalculationJob|null>(null);
 readonly loading=signal(false);readonly working=signal(false);readonly error=signal('');
 readonly active=()=>calculationActive(this.job());readonly message=()=>this.job()?calculationMessage(this.job()!):'';
 private generation=0;private read?:Subscription;private action?:Subscription;private poll?:Subscription;
 private uncertain=true;private completed:()=>void=()=>{};
 constructor(private readonly api:DailyCalculationApiService){}
 initialize(completed:()=>void=()=>{}){this.completed=completed;this.load()}
 ngOnDestroy(){this.generation++;this.stop()}
 private stop(){this.read?.unsubscribe();this.action?.unsubscribe();this.poll?.unsubscribe()}
 load(){
  const generation=++this.generation;this.stop();this.loading.set(true);this.working.set(false);this.error.set('');this.uncertain=true;
  this.read=this.api.state().subscribe({next:state=>{
   if(generation!==this.generation)return;this.state.set(state);this.job.set(state.activeJob??state.latestJob);this.loading.set(false);this.uncertain=false;
   if(state.activeJob)this.check();
  },error:()=>{if(generation===this.generation){this.loading.set(false);this.error.set('Could not check calculation status. Check status before starting another run.')}}});
 }
 start(){if(this.loading()||this.working()||this.active())return;if(this.uncertain){this.load();return;}this.submit(()=>this.api.start())}
 cancel(){const job=this.job();if(job&&this.active()&&!this.working())this.submit(()=>this.api.cancel(job.id))}
 retry(){const job=this.job();if(!job||!['failed','cancelled'].includes(job.status)||this.working())return;if(this.uncertain){this.load();return;}this.submit(()=>this.api.retry(job.id))}
 private submit(request:()=>ReturnType<DailyCalculationApiService['start']>){
  const generation=++this.generation;this.stop();this.working.set(true);this.error.set('');
  this.action=request().subscribe({next:job=>{if(generation===this.generation){this.job.set(job);this.working.set(false);this.check()}},error:()=>{if(generation===this.generation){this.working.set(false);this.uncertain=true;this.error.set('Could not confirm the calculation request. Check status before trying again.')}}});
 }
 check(){
  const job=this.job();if(!job){this.load();return;}this.poll?.unsubscribe();this.error.set('');const generation=this.generation;
  this.poll=(calculationTerminal(job)?of({state:'terminal' as const,job,attempt:0}):pollDurableJob(()=>this.api.job(job.id),{intervalMs:3000,maxAttempts:200,maxDurationMs:600000,isTerminal:calculationTerminal})).subscribe(event=>{
   if(generation!==this.generation)return;
   if(event.job){if(event.job.id!==job.id){this.uncertain=true;this.error.set('Unexpected calculation response. Check status.');return;}this.job.set(event.job)}
   if(event.state==='terminal'){
    this.completed();this.uncertain=true;
    this.read=this.api.state().subscribe({next:state=>{if(generation===this.generation){this.state.set(state);this.uncertain=false;}},error:()=>{if(generation===this.generation)this.error.set('Calculation finished; check status to reload the cursor.')}});
   }else if(event.state==='error'||event.state==='exhausted'){this.error.set('Automatic checks paused. The worker continues; Check status resumes checking.')}
  });
 }
}
