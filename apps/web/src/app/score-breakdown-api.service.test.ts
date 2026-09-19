import type { HttpClient } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SPORTOS_API_BASE } from './core/config/api-base';
import { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

function createService(http: HttpClient): ScoreBreakdownApiService {
  const injector = Injector.create({
    providers: [{ provide: SPORTOS_API_BASE, useValue: 'http://sportos.test' }],
  });
  return runInInjectionContext(injector, () => new ScoreBreakdownApiService(http));
}

const response: DailyScoreBreakdown = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  scoreStatus: 'calculated',
  facts: { steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0 },
  score: { appTotal: 0, excelTotal: null, delta: null, baseTotal: 0, bonusPoints: 0, ledgerTotal: 0 },
  sourceRecord: null,
  activities: [],
  garminObservations: [],
  sourceRecords: [],
  ledger: [],
};

describe('ScoreBreakdownApiService', () => {
  it('requests the owner-scoped running estimate for a date', () => {
    const get = vi.fn().mockReturnValue(of({ estimatedRunningSteps: 3000, unestimatedRunCount: 0 }));
    const service = createService({ get } as unknown as HttpClient);
    service.runningStepEstimate('2026/05?18').subscribe();
    expect(get).toHaveBeenCalledWith('http://sportos.test/daily/2026%2F05%3F18/running-step-estimate');
  });
  it('requests bounded quick-entry facts from the configured API base', () => {
    const get = vi.fn().mockReturnValue(of([]));
    const service = createService({ get } as unknown as HttpClient);

    service.manualFacts({ from: '2026-05-01', to: '2026-05-31', limit: 100 }).subscribe();

    expect(get).toHaveBeenCalledWith('http://sportos.test/daily/manual-facts', {
      params: { from: '2026-05-01', to: '2026-05-31', limit: '100' },
    });
  });

  it('requests the encoded date from the configured SportOS API base', () => {
    const get = vi.fn().mockReturnValue(of(response));
    const http = { get } as unknown as HttpClient;
    const service = createService(http);
    let received: DailyScoreBreakdown | undefined;

    service.getForDate('2026/05?18').subscribe((value) => { received = value; });

    expect(get).toHaveBeenCalledWith('http://sportos.test/daily/2026%2F05%3F18/score-breakdown');
    expect(received).toEqual(response);
  });

  it('requests date-scoped evidence independently of a persisted score', () => {
    const evidence = { date: response.date, garminObservations: [], sourceRecords: [] };
    const get = vi.fn().mockReturnValue(of(evidence));
    const service = createService({ get } as unknown as HttpClient);

    service.getEvidence('2026/05?18').subscribe();

    expect(get).toHaveBeenCalledWith('http://sportos.test/daily/2026%2F05%3F18/evidence');
  });

  it('posts an explicit recalculation request for the encoded date', () => {
    const post = vi.fn().mockReturnValue(of(response));
    const http = { post } as unknown as HttpClient;
    const service = createService(http);

    service.recalculate('2026/05?18').subscribe();

    expect(post).toHaveBeenCalledWith('http://sportos.test/daily/2026%2F05%3F18/recalculate', {});
  });

  it('puts validated manual facts for the encoded date', () => {
    const put = vi.fn().mockReturnValue(of({ ...response, scoreStatus: 'manual' }));
    const http = { put } as unknown as HttpClient;
    const service = createService(http);
    const input = {
      steps: 1000, runIndoorM: 1000, runOutdoorM: 3000,
      runUnspecifiedM: 0, bikeIndoorM: 0, bikeOutdoorM: 0, bikeUnspecifiedM: 0, swimM: 0,
      workoutPoints: 10, bonusPoints: 5,
    };

    service.saveManualFacts('2026/05?18', input).subscribe();

    expect(put).toHaveBeenCalledWith('http://sportos.test/daily/2026%2F05%3F18/facts', input);
  });
});
