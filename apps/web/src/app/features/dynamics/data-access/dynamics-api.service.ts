import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type {
  DynamicsGranularity,
  DynamicsMetric,
  DynamicsResponse,
  RollingDynamicsResponse,
  RollingWindow,
} from '../model/dynamics.models';

@Injectable({ providedIn: 'root' })
export class DynamicsApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);

  constructor(private readonly http: HttpClient) {}

  monthlyStats(query: { from: string; to: string; granularity: DynamicsGranularity; metrics: DynamicsMetric[] }) {
    return this.http.get<DynamicsResponse>(`${this.apiBase}/dynamics/monthly`, {
      params: queryParams({ ...query, metrics: query.metrics.join(',') }),
    });
  }

  rollingDynamics(query: { from: string; to: string; metric: DynamicsMetric; windows: RollingWindow[] }) {
    return this.http.get<RollingDynamicsResponse>(`${this.apiBase}/dynamics/rolling`, {
      params: queryParams({ ...query, windows: query.windows.join(',') }),
    });
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
