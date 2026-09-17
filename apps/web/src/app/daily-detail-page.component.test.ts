import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DailyDetailPageComponent } from './daily-detail-page.component';
import type { ProviderApiService } from './provider-api.service';
import type { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

const date = '2026-09-11';
const breakdown: DailyScoreBreakdown = {
  date,
  recomputedAt: '2026-09-11T12:00:00.000Z',
  scoreStatus: 'manual',
  facts: { steps: 5070, runM: 0, bikeM: 27550, swimM: 0, workoutPoints: 0 },
  score: { appTotal: 24978, excelTotal: null, delta: null, baseTotal: 22978, bonusPoints: 2000, ledgerTotal: 24978 },
  sourceRecord: null,
  activities: [],
  garminObservations: [],
  sourceRecords: [],
  ledger: [],
};

describe('DailyDetailPageComponent', () => {
  it('loads the complete day from the route and requests edit mode', () => {
    const api = { getForDate: vi.fn().mockReturnValue(of(breakdown)) };
    const component = createComponent(api, { edit: 'true' });

    component.ngOnInit();

    expect(api.getForDate).toHaveBeenCalledWith(date);
    expect(component.breakdown()).toEqual(breakdown);
    expect(component.state()).toBe('loaded');
    expect(component.manualEditRequestId()).toBe(1);
  });

  it('keeps dated Garmin evidence visible when no score exists', () => {
    const evidence = { date, garminObservations: [], sourceRecords: [] };
    const api = {
      getForDate: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 404,
        error: { code: 'DAILY_SCORE_NOT_FOUND' },
      }))),
      getEvidence: vi.fn().mockReturnValue(of(evidence)),
    };
    const component = createComponent(api);

    component.ngOnInit();

    expect(component.state()).toBe('loaded');
    expect(component.breakdown()).toBeNull();
    expect(component.evidence()).toEqual(evidence);
  });

  it('allows manual entry when the selected day does not exist yet', () => {
    const api = { getForDate: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 404,
      error: { code: 'DAILY_SCORE_NOT_FOUND' },
    }))) };
    const component = createComponent(api, { edit: 'true' });

    component.ngOnInit();

    expect(component.state()).toBe('loaded');
    expect(component.breakdown()).toBeNull();
    expect(component.manualEditRequestId()).toBe(1);
  });

  it('saves all manual facts and removes the edit query', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const api = {
      getForDate: vi.fn().mockReturnValue(of(breakdown)),
      saveManualFacts: vi.fn().mockReturnValue(of(breakdown)),
    };
    const component = createComponent(api, { edit: 'true' }, router);
    component.ngOnInit();
    const input = { steps: 5070, runIndoorM: 0, runOutdoorM: 0, runUnspecifiedM: 0, bikeIndoorM: 0, bikeOutdoorM: 27550, bikeUnspecifiedM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 2000 };

    component.saveManualFacts(input);

    expect(api.saveManualFacts).toHaveBeenCalledWith(date, input);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {}, replaceUrl: true }));
    expect(component.savingManual()).toBe(false);
  });

  it('refetches the selected calendar day from Strava before recalculating it', () => {
    const job = {
      id: 'job-1', connectionId: 'connection-1', mode: 'webhook_refresh', batchId: 'batch-1',
      status: 'succeeded', phase: 'completed', progressPercent: 100, attemptCount: 1, maxAttempts: 5,
      cancellationRequested: false, requestedAfter: null, requestedBefore: null, error: null, result: {},
      createdAt: '', updatedAt: '', startedAt: '', completedAt: '',
    } as const;
    const providerApi = {
      connections: vi.fn().mockReturnValue(of([{ id: 'connection-1', provider: 'strava', status: 'connected' }])),
      enqueueSync: vi.fn().mockReturnValue(of(job)),
      syncJob: vi.fn(),
    };
    const api = {
      getForDate: vi.fn().mockReturnValue(of(breakdown)),
      recalculate: vi.fn().mockReturnValue(of(breakdown)),
    };
    const component = createComponent(api, {}, undefined, providerApi);
    component.ngOnInit();

    component.refreshFromStrava();

    expect(providerApi.enqueueSync).toHaveBeenCalledWith('connection-1', 'webhook_refresh', {
      after: '2026-09-10T09:00:00.000Z',
      before: '2026-09-12T12:00:00.000Z',
    });
    expect(api.recalculate).toHaveBeenCalledWith(date);
    expect(component.stravaRefreshStatus()).toContain('latest activities');
    expect(component.refreshingFromStrava()).toBe(false);
  });
});

function createComponent(
  api: { getForDate: ReturnType<typeof vi.fn>; getEvidence?: ReturnType<typeof vi.fn>; saveManualFacts?: ReturnType<typeof vi.fn> },
  query: Record<string, string> = {},
  router: { navigate: ReturnType<typeof vi.fn> } | undefined = undefined,
  providerApi: { connections: ReturnType<typeof vi.fn>; enqueueSync?: ReturnType<typeof vi.fn>; syncJob?: ReturnType<typeof vi.fn> } = { connections: vi.fn().mockReturnValue(of([])) },
): DailyDetailPageComponent {
  const route = {
    paramMap: of(convertToParamMap({ date })),
    snapshot: { queryParamMap: convertToParamMap(query) },
  };
  return new DailyDetailPageComponent(
    route as unknown as ActivatedRoute,
    (router ?? { navigate: vi.fn().mockResolvedValue(true) }) as unknown as Router,
    {
      getEvidence: vi.fn().mockReturnValue(of({ date, garminObservations: [], sourceRecords: [] })),
      ...api,
    } as unknown as ScoreBreakdownApiService,
    providerApi as unknown as ProviderApiService,
  );
}
