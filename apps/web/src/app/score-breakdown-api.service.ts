import { HttpClient } from '@angular/common/http';
import { Inject, Injectable } from '@angular/core';
import { SPORTOS_API_BASE } from './core/config/api-base';
import type { DailyEvidence, DailyScoreBreakdown, ManualDailyFactsInput, ManualDailyFactsRow } from './score-breakdown.models';

@Injectable({ providedIn: 'root' })
export class ScoreBreakdownApiService {
  constructor(
    private readonly http: HttpClient,
    @Inject(SPORTOS_API_BASE) private readonly apiBase: string,
  ) {}

  getForDate(date: string) {
    return this.http.get<DailyScoreBreakdown>(
      `${this.apiBase}/daily/${encodeURIComponent(date)}/score-breakdown`,
    );
  }

  getEvidence(date: string) {
    return this.http.get<DailyEvidence>(
      `${this.apiBase}/daily/${encodeURIComponent(date)}/evidence`,
    );
  }

  manualFacts(input: { from?: string; to?: string; limit?: number }) {
    const params: Record<string, string> = {};
    if (input.from) params['from'] = input.from;
    if (input.to) params['to'] = input.to;
    if (input.limit !== undefined) params['limit'] = String(input.limit);
    return this.http.get<ManualDailyFactsRow[]>(`${this.apiBase}/daily/manual-facts`, { params });
  }

  recalculate(date: string) {
    return this.http.post<DailyScoreBreakdown>(
      `${this.apiBase}/daily/${encodeURIComponent(date)}/recalculate`,
      {},
    );
  }

  runningStepEstimate(date: string) {
    return this.http.get<{ estimatedRunningSteps: number; unestimatedRunCount: number }>(
      `${this.apiBase}/daily/${encodeURIComponent(date)}/running-step-estimate`,
    );
  }

  saveManualFacts(date: string, input: ManualDailyFactsInput) {
    return this.http.put<DailyScoreBreakdown>(
      `${this.apiBase}/daily/${encodeURIComponent(date)}/facts`,
      input,
    );
  }
}
