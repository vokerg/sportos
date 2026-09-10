import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import type { DailyScoreBreakdown, ManualDailyFactsInput } from './score-breakdown.models';

@Injectable({ providedIn: 'root' })
export class ScoreBreakdownApiService {
  constructor(
    private readonly http: HttpClient,
    private readonly api: ApiService,
  ) {}

  getForDate(date: string) {
    return this.http.get<DailyScoreBreakdown>(
      `${this.api.apiBase()}/daily/${encodeURIComponent(date)}/score-breakdown`,
    );
  }

  recalculate(date: string) {
    return this.http.post<DailyScoreBreakdown>(
      `${this.api.apiBase()}/daily/${encodeURIComponent(date)}/recalculate`,
      {},
    );
  }

  saveManualFacts(date: string, input: ManualDailyFactsInput) {
    return this.http.put<DailyScoreBreakdown>(
      `${this.api.apiBase()}/daily/${encodeURIComponent(date)}/facts`,
      input,
    );
  }
}
