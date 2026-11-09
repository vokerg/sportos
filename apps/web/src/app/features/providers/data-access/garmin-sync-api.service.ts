import {inject,Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {SPORTOS_API_BASE} from '../../../core/config/api-base';
import type {GarminFetchJob} from '../../../shared/model/garmin-job';
export interface GarminConnectionStatus {
 enabled:boolean;reason:string;timeZone:string;
 cursor:{date:string;at:string;completed:boolean}|null;activeJob:GarminFetchJob|null;
}
@Injectable({providedIn:'root'})
export class GarminSyncApiService {
 private readonly http=inject(HttpClient);private readonly base=inject(SPORTOS_API_BASE);
 connection(){return this.http.get<GarminConnectionStatus>(`${this.base}/garmin/connection`)}
 sync(){return this.http.post<GarminFetchJob>(`${this.base}/garmin/sync`,{})}
 job(id:string){return this.http.get<GarminFetchJob>(`${this.base}/garmin/jobs/${encodeURIComponent(id)}`)}
 cancel(id:string){return this.http.post<GarminFetchJob>(`${this.base}/garmin/jobs/${encodeURIComponent(id)}/cancel`,{})}
 retry(id:string){return this.http.post<GarminFetchJob>(`${this.base}/garmin/jobs/${encodeURIComponent(id)}/retry`,{})}
}
