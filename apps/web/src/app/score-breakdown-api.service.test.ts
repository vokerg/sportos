import type { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService } from './api.service';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

const response: DailyScoreBreakdown = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  facts: { steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 0, excelTotal: null, delta: null, baseTotal: 0, bonusTotal: 0, ledgerTotal: 0 },
  sourceRecord: null,
  activities: [],
  sourceRecords: [],
  ledger: [],
};

describe('ScoreBreakdownApiService', () => {
  it('requests the encoded date from the configured SportOS API base', () => {
    const get = vi.fn().mockReturnValue(of(response));
    const http = { get } as unknown as HttpClient;
    const api = { apiBase: signal('http://sportos.test') } as unknown as ApiService;
    const service = new ScoreBreakdownApiService(http, api);
    let received: DailyScoreBreakdown | undefined;

    service.getForDate('2026/05?18').subscribe((value) => { received = value; });

    expect(get).toHaveBeenCalledWith('http://sportos.test/daily/2026%2F05%3F18/score-breakdown');
    expect(received).toEqual(response);
  });
});
