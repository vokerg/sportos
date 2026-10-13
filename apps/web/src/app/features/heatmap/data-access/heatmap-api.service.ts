import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import { HEATMAP_PAGE_SIZE, type HeatmapFilters, type HeatmapPage } from '../model/heatmap.models';

@Injectable({ providedIn: 'root' })
export class HeatmapApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);
  private readonly http = inject(HttpClient);

  list(filters: HeatmapFilters, cursor?: string) {
    let params = new HttpParams().set('limit', String(HEATMAP_PAGE_SIZE));
    if (filters.from) params = params.set('from', filters.from);
    if (filters.to) params = params.set('to', filters.to);
    if (filters.activityType) params = params.set('activityType', filters.activityType);
    if (cursor) params = params.set('cursor', cursor);
    // HTTP interceptor supplies the session context; no persistent or public route cache.
    return this.http.get<HeatmapPage>(`${this.apiBase}/heatmap/routes`, { params });
  }
}
