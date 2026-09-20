import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type {
  PerformanceEventDetail,
  PerformanceEventQuery,
  PerformanceEventRow,
  PerformanceRow,
} from '../model/performance.models';

@Injectable({ providedIn: 'root' })
export class PerformanceApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  bestPerformance(distanceM: number, limit = 50) {
    return this.http.get<PerformanceRow[]>(`${this.apiBase}/performance/best?distanceM=${distanceM}&limit=${limit}`);
  }

  performanceEvents(query: PerformanceEventQuery) {
    return this.http.get<PerformanceEventRow[]>(`${this.apiBase}/performance/events`, { params: queryParams(query) });
  }

  performanceEvent(eventId: string) {
    return this.http.get<PerformanceEventDetail>(
      `${this.apiBase}/performance/events/${encodeURIComponent(eventId)}`,
    );
  }
}

function queryParams<T extends object>(values: T): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if ((typeof value === 'string' || typeof value === 'number') && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
