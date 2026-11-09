import {Component,input,OnInit,output} from '@angular/core';
import {GarminSyncStore} from '../state/garmin-sync.store';
@Component({
 selector:'sportos-garmin-sync-control',standalone:true,providers:[GarminSyncStore],
 template:`
  <div class="garmin-controls" aria-label="Garmin sync">
   <button type="button" class="garmin-sync-button" (click)="store.sync()" [disabled]="store.loading()||store.working()||store.active()||!store.connection()?.enabled">{{store.loading()?'Checking Garmin…':store.working()?'Starting Garmin…':store.active()?'Syncing Garmin…':'Sync Garmin'}}</button>
   @if(store.error()){<span role="alert">{{store.error()}}</span><button type="button" class="secondary" (click)="store.load()">Check Garmin status</button>}
   @if(store.connection();as connection){
    @if(!connection.enabled){<small>{{connection.reason==='worker_offline'?'Garmin worker is offline.':connection.reason==='reauthorization_required'?'Garmin needs reconnecting.':'Garmin is not connected.'}}</small>}
    @if(connection.cursor;as cursor){<small>Garmin cursor: {{cursor.date}} · {{timestamp(cursor.at,connection.timeZone)}} <span>{{cursor.completed?'last new day processed':'initial start'}}</span></small>}
   }
   @if(store.job();as job){
    <div class="garmin-progress" aria-live="polite">
     <span>Garmin {{job.status}} @if(job.operation==='sync'){ · {{job.processedDays??0}} / {{job.totalDays??0}} days @if(job.nextDate&&job.status!=='succeeded'){ · {{job.nextDate}} }}</span>
     @if(job.operation==='sync'){<progress [max]="job.totalDays??1" [value]="job.processedDays??0"></progress>}
     <small>{{store.message()}}</small>
     @if(store.active()){<button type="button" class="secondary" (click)="store.check()">Check status</button><button type="button" class="secondary" [disabled]="store.working()" (click)="store.cancel()">Cancel Garmin sync</button>}
     @if(job.status==='failed'||job.status==='cancelled'){<button type="button" [disabled]="store.working()||!store.connection()?.enabled" (click)="store.retry()">Retry Garmin sync</button>}
    </div>
   }
   @if(detailed()){<p>Refresh from the cursor day through today, including final steps and late uploads. Repeating sync today is supported. Fetching a newer day advances the cursor; re-fetching an already covered day leaves it unchanged. Scores change only with Recalculate.</p>}
  </div>`,
 styles:[`:host{display:block}.garmin-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.garmin-sync-button{background:var(--primary);color:var(--on-primary);padding:10px 14px;border-radius:11px;white-space:nowrap}.garmin-controls small{color:var(--text-muted);font-size:11px}.garmin-controls small span{display:block}.garmin-progress{display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex-basis:100%}.garmin-progress small{flex-basis:100%}progress{width:130px}p{color:var(--text-muted);font-size:13px}`],
})
export class GarminSyncControlComponent implements OnInit{
 readonly detailed=input(false);readonly synced=output<void>();
 constructor(readonly store:GarminSyncStore){}
 timestamp(value:string,timeZone:string){try{return new Intl.DateTimeFormat(undefined,{dateStyle:'short',timeStyle:'short',timeZone}).format(new Date(value))}catch{return value}}
 ngOnInit(){this.store.initialize(()=>this.synced.emit())}
}
