import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import type { DailyEvidence, DailyScoreBreakdown, ManualDailyFactsInput, ManualDailyFactsRow } from './score-breakdown.models';

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

  getEvidence(date: string) {
    return this.http.get<DailyEvidence>(
      `${this.api.apiBase()}/daily/${encodeURIComponent(date)}/evidence`,
    );
  }

  manualFacts(input: { from?: string; to?: string; limit?: number }) {
    const params: Record<string, string> = {};
    if (input.from) params['from'] = input.from;
    if (input.to) params['to'] = input.to;
    if (input.limit !== undefined) params['limit'] = String(input.limit);
    return this.http.get<ManualDailyFactsRow[]>(`${this.api.apiBase()}/daily/manual-facts`, { params });
  }

  recalculate(date: string) {
    return this.http.post<DailyScoreBreakdown>(
      `${this.api.apiBase()}/daily/${encodeURIComponent(date)}/recalculate`,
      {},
    );
  }

  runningStepEstimate(date: string) {
    return this.http.get<{ estimatedRunningSteps: number; unestimatedRunCount: number }>(
      `${this.api.apiBase()}/daily/${encodeURIComponent(date)}/running-step-estimate`,
    );
  }

  saveManualFacts(date: string, input: ManualDailyFactsInput) {
    return this.http.put<DailyScoreBreakdown>(
      `${this.api.apiBase()}/daily/${encodeURIComponent(date)}/facts`,
      input,
    );
  }
}
