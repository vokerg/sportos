import {pollDurableJob} from '../../../core/jobs/durable-job-poller';
import {activeGarminJob,terminalGarminJob,garminJobMessage,type GarminFetchJob} from '../../../shared/model/garmin-job';
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription,of } from 'rxjs';
import { GarminDayApiService } from '../data-access/garmin-day-api.service';
import type { GarminDay, GarminDayCategory } from '../model/garmin-day.models';
@Injectable()
export class GarminDayStore implements OnDestroy {
  readonly data = signal<GarminDay | null>(null);
  readonly loading = signal(false); readonly fetching = signal(false); readonly error = signal('');
  readonly job=signal<GarminFetchJob|null>(null); readonly jobMessage=signal('');
  private poll?:Subscription;private jobAction?:Subscription;
  readonly expanded = signal(false); readonly resourceLoading = signal(false);
  readonly resourceJson = signal<string | null>(null); readonly resourceError = signal('');
  private date = ''; private generation = 0; private request?: Subscription; private resourceRequest?: Subscription;
  constructor(private readonly api: GarminDayApiService) {}
  ngOnDestroy() { this.cancel(); }
  private cancel() { this.generation++; this.request?.unsubscribe(); this.resourceRequest?.unsubscribe();this.poll?.unsubscribe();this.jobAction?.unsubscribe(); }
  load(date: string) {
    this.cancel();this.job.set(null);this.jobMessage.set(''); this.date = date; this.data.set(null); this.loading.set(true); this.fetching.set(false);
    this.error.set(''); this.expanded.set(false); this.resourceJson.set(null); this.resourceError.set(''); this.resourceLoading.set(false);
    const generation = this.generation;
    this.request = this.api.read(date).subscribe({ next: data => { if (generation === this.generation) { this.data.set(data); this.expanded.set(data.categories.some(category => Boolean(category.retainedAt))); this.loading.set(false);this.job.set(data.activeJob??null);if(activeGarminJob(data.activeJob))this.checkJob(); } },
      error: () => { if (generation === this.generation) { this.loading.set(false); this.error.set('Could not read retained Garmin day evidence. Retry loading.'); } } });
  }
  view() { this.expanded.set(!this.expanded()); }
  fetch(refresh = false) {
    if (!this.date || this.fetching() || this.loading() || !this.data()?.fetchEnabled) return;
    if(activeGarminJob(this.job())){this.checkJob();return;}
    this.request?.unsubscribe(); this.fetching.set(true); this.error.set(''); const generation = this.generation;
    this.request = this.api.fetch(this.date, refresh).subscribe({ next: job => {
      if (generation !== this.generation) return;
      if(job.operation!=='day'||job.date!==this.date){this.fetching.set(false);this.error.set('Unexpected Garmin job response. Reload this day.');return;}
      this.job.set(job);this.checkJob();
    }, error: error => { if (generation === this.generation) { this.fetching.set(false); this.error.set(message(error)); } } });
  }
  checkJob(){
    const current=this.job();if(!current)return;
    this.poll?.unsubscribe();this.fetching.set(true);this.error.set('');const generation=this.generation;
    this.poll=(terminalGarminJob(current)?of({state:'terminal' as const,attempt:0,job:current}):pollDurableJob(()=>this.api.job(current.id),{intervalMs:5000,maxAttempts:120,maxDurationMs:600000,isTerminal:terminalGarminJob})).subscribe(event=>{
      if(generation!==this.generation)return;
      if(event.job){if(event.job.id!==current.id||event.job.operation!=='day'||event.job.date!==this.date){this.poll?.unsubscribe();this.fetching.set(false);this.error.set('Unexpected Garmin job response.');return;}this.job.set(event.job);this.jobMessage.set(garminJobMessage(event.job));}
      if(event.state==='terminal'){
        this.fetching.set(false);this.expanded.set(true);this.resourceJson.set(null);
        this.request=this.api.read(this.date).subscribe({next:data=>{if(generation===this.generation)this.data.set(data)},error:()=>{if(generation===this.generation)this.error.set('Job finished; saved evidence could not reload. Reload this day.')}});
      }else if(event.state==='error'||event.state==='exhausted'){this.fetching.set(false);this.error.set('Automatic checks paused. The worker job continues; check status to resume.');}
    });
  }
  cancelJob(){const job=this.job();if(!job)return;const generation=this.generation;this.jobAction?.unsubscribe();this.jobAction=this.api.cancel(job.id).subscribe({next:result=>{if(generation===this.generation){this.job.set(result);this.checkJob()}},error:()=>{if(generation===this.generation)this.error.set('Could not request cancellation. Check status.')}})}
  retryJob(){const job=this.job();if(!job||this.fetching())return;const generation=this.generation;this.fetching.set(true);this.jobAction=this.api.retry(job.id).subscribe({next:result=>{if(generation===this.generation){this.job.set(result);this.checkJob()}},error:()=>{if(generation===this.generation){this.fetching.set(false);this.error.set('Could not retry Garmin. Check connection and worker availability.')}}})}
  resource(category: GarminDayCategory) {
    this.resourceRequest?.unsubscribe(); this.resourceLoading.set(true); this.resourceJson.set(null); this.resourceError.set(''); const generation = this.generation;
    this.resourceRequest = this.api.resource(this.date, category).subscribe({ next: data => {
      if (generation === this.generation) { this.resourceJson.set(JSON.stringify(data.payload, null, 2)); this.resourceLoading.set(false); }
    }, error: () => { if (generation === this.generation) { this.resourceError.set('Retained resource could not be read. Retry later.'); this.resourceLoading.set(false); } } });
  }
}
function message(error: unknown): string {
  if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') return error.error.message.slice(0,300);
  return 'Garmin fetch failed or timed out. Prior retained evidence is safe; check the worker and connection before retrying.';
}
