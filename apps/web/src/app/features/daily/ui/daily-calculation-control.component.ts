import {Component,OnInit,output} from '@angular/core';
import {DailyCalculationStore} from '../state/daily-calculation.store';
@Component({
 selector:'sportos-daily-calculation-control',standalone:true,providers:[DailyCalculationStore],
 template:`<section aria-label="Calculate daily scores">
  <button type="button" (click)="store.start()" [disabled]="store.loading()||store.working()||store.active()||!store.state()||!!store.error()">{{store.loading()?'Checking calculations…':store.working()?'Starting calculation…':store.active()?'Calculating…':'Calculate all'}}</button>
  @if(store.state();as state){<small>Completed through: {{state.cursor.completedThrough??'not yet started'}} · Next: {{state.nextDate}} · {{state.cursor.timeZone}}</small>}
  <small>Uses retained data through today. Today stays provisional and is recalculated on every run.</small>
  @if(store.job();as job){
   <div aria-live="polite">Calculation {{job.status}} · {{job.processedDays}} / {{job.totalDays}} days @if(job.status!=='succeeded'){ · {{job.nextDate}} }
    <progress [max]="job.totalDays" [value]="job.processedDays"></progress><small>{{store.message()}}</small>
   </div>
   @if(store.active()){<button type="button" class="secondary" (click)="store.check()">Check calculation job</button><button type="button" class="secondary" [disabled]="store.working()" (click)="store.cancel()">Cancel calculation</button>}
   @if(job.status==='failed'||job.status==='cancelled'){<button type="button" [disabled]="store.working()||!!store.error()" (click)="store.retry()">Retry calculation</button>}
  }
  @if(store.error()){<span role="alert">{{store.error()}}</span>}
  <button type="button" class="secondary" [disabled]="store.loading()||store.working()" (click)="store.load()">Check calculation status</button>
 </section>`,
 styles:[`:host{display:block}section{display:flex;flex-wrap:wrap;align-items:center;gap:8px}small{display:block;color:var(--text-muted);font-size:12px;flex-basis:100%}button{padding:10px 14px;border-radius:11px}progress{width:120px;margin-left:8px}`],
})
export class DailyCalculationControlComponent implements OnInit {
 readonly calculated=output<void>();constructor(readonly store:DailyCalculationStore){}
 ngOnInit(){this.store.initialize(()=>this.calculated.emit())}
}
