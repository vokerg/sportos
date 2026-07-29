import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ApiService } from './api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

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
}
