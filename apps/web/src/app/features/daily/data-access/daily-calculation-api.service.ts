import {inject,Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {SPORTOS_API_BASE} from '../../../core/config/api-base';
import type {DailyCalculationJob,DailyCalculationState} from '../model/daily-calculation.models';
@Injectable({providedIn:'root'})
export class DailyCalculationApiService {
 private readonly http=inject(HttpClient);private readonly base=inject(SPORTOS_API_BASE)+'/daily/recalculation';
 state(){return this.http.get<DailyCalculationState>(this.base)}
 start(){return this.http.post<DailyCalculationJob>(this.base,{})}
 job(id:string){return this.http.get<DailyCalculationJob>(this.base+'/jobs/'+encodeURIComponent(id))}
 cancel(id:string){return this.http.post<DailyCalculationJob>(this.base+'/jobs/'+encodeURIComponent(id)+'/cancel',{})}
 retry(id:string){return this.http.post<DailyCalculationJob>(this.base+'/jobs/'+encodeURIComponent(id)+'/retry',{})}
}
