import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type { DailySummaryRow, DateRangeQuery } from '../model/daily.models';

@Injectable({ providedIn: 'root' })
export class DailyApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  dailySummary(query: DateRangeQuery | number = { limit: 365 }) {
    const normalized = typeof query === 'number' ? { limit: query } : query;
    return this.http.get<DailySummaryRow[]>(`${this.apiBase}/daily/summary`, { params: queryParams(normalized) });
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
