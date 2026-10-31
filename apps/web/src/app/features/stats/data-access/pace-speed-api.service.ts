import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from '../../../core/config/api-base';
import type { PaceSpeedGranularity, PaceSpeedResponse, PaceSpeedSport } from '../model/pace-speed.models';

@Injectable({ providedIn: 'root' })
export class PaceSpeedApiService {
  private readonly apiBase = inject(SPORTOS_API_BASE);
  constructor(private readonly http: HttpClient) {}

  trends(query: {
    from: string;
    to: string;
    sport: PaceSpeedSport;
    granularity: PaceSpeedGranularity;
    threshold: number | null;
  }) {
    let params = new HttpParams()
      .set('from', query.from)
      .set('to', query.to)
      .set('sport', query.sport)
      .set('granularity', query.granularity);
    if (query.threshold !== null) params = params.set('threshold', String(query.threshold));
    return this.http.get<PaceSpeedResponse>(this.apiBase + '/stats/pace-speed', { params });
  }
}
