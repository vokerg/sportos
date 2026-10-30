import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {GarminFetchJob} from '../../../shared/model/garmin-job';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type { GarminDay, GarminDayCategory } from '../model/garmin-day.models';
@Injectable({ providedIn: 'root' })
export class GarminDayApiService {
  private readonly base = inject(SPORTOS_API_BASE);
  constructor(private readonly http: HttpClient) {}
  read(date: string) { return this.http.get<GarminDay>(`${this.base}/daily/${date}/garmin`); }
  fetch(date: string, refresh: boolean) { return this.http.post<GarminFetchJob>(`${this.base}/daily/${date}/garmin`, { refresh }); }
  job(id:string){return this.http.get<GarminFetchJob>(`${this.base}/garmin/jobs/${encodeURIComponent(id)}`);}
  cancel(id:string){return this.http.post<GarminFetchJob>(`${this.base}/garmin/jobs/${encodeURIComponent(id)}/cancel`,{});}
  retry(id:string){return this.http.post<GarminFetchJob>(`${this.base}/garmin/jobs/${encodeURIComponent(id)}/retry`,{});}
  resource(date: string, category: GarminDayCategory) { return this.http.get<{ category: GarminDayCategory; payload: unknown }>(`${this.base}/daily/${date}/garmin/resources/${category}`); }
}
