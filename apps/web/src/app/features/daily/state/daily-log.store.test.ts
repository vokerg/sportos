import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, DailySummaryRow } from '../../../api.service';
import type { ProviderApiService, ProviderSyncJob } from '../../../provider-api.service';
import type { ScoreBreakdownApiService } from '../../../score-breakdown-api.service';
import type { DailyScoreBreakdown } from '../../../score-breakdown.models';
import { DailyLogStore } from './daily-log.store';

const row: DailySummaryRow = {
  metric_date: '2026-05-18',
  steps: 12_345,
  run_m: 5_000,
  bike_m: 0,
  swim_m: 0,
  workout_points: 0,
  base_points: 20,
  bonus_points: 5,
  total_points: 25,
  excel_all_points: 24,
  points_delta_vs_excel: 1,
  avg_10d: 20,
  avg_20d: 19,
  avg_30d: 18,
  avg_60d: 17,
  avg_365d: 16,
  score_status: 'calculated',
};

const breakdown: DailyScoreBreakdown = {
  date: row.metric_date,
  recomputedAt: '2026-05-18T12:00:00.000Z',
  scoreStatus: 'calculated',
  facts: { steps: row.steps, runM: row.run_m, bikeM: 0, swimM: 0, workoutPoints: 0 },
  score: { appTotal: 25, excelTotal: 24, delta: 1, baseTotal: 20, bonusPoints: 5, ledgerTotal: 25 },
  sourceRecord: null,
  activities: [],
  garminObservations: [],
  sourceRecords: [],
  ledger: [],
};

describe('DailyLogStore', () => {
  it('initializes the default range, summary, and Strava connection once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    try {
      const api = { dailySummary: vi.fn().mockReturnValue(of([row])) };
      const providerApi = {
        connections: vi.fn().mockReturnValue(of([{ id: 'connection-1', provider: 'strava', status: 'connected' }])),
      };
      const store = createStore({}, api, providerApi);

      store.initialize();
      store.initialize();

      expect(store.quickRange()).toBe('3m');
      expect(store.from()).toBe('2026-06-11');
      expect(store.to()).toBe('2026-09-11');
      expect(api.dailySummary).toHaveBeenCalledTimes(1);
      expect(api.dailySummary).toHaveBeenCalledWith({ from: '2026-06-11', to: '2026-09-11', limit: 10_000 });
      expect(providerApi.connections).toHaveBeenCalledTimes(1);
      expect(store.stravaConnection()?.id).toBe('connection-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a reversed range without issuing a request', () => {
    const api = { dailySummary: vi.fn().mockReturnValue(of([])) };
    const store = createStore({}, api);
    store.from.set('2026-05-20');
    store.to.set('2026-05-18');

    store.applyFilters();

    expect(store.summaryState()).toBe('error');
    expect(store.summaryError()).toContain('on or before');
    expect(api.dailySummary).not.toHaveBeenCalled();
  });

  it('cancels a replaced summary request so its late result cannot overwrite the active range', () => {
    const first = new Subject<DailySummaryRow[]>();
    const second = new Subject<DailySummaryRow[]>();
    const nextRow = { ...row, metric_date: '2026-05-19' };
    const api = {
      dailySummary: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    };
    const store = createStore({}, api);

    store.loadRows();
    store.loadRows();
    first.next([row]);
    second.next([nextRow]);

    expect(store.rows()).toEqual([nextRow]);
    expect(store.summaryState()).toBe('loaded');
  });

  it('cancels a previous breakdown request so stale responses cannot replace the selected date', () => {
    const first = new Subject<DailyScoreBreakdown>();
    const second = new Subject<DailyScoreBreakdown>();
    const scoreApi = {
      getForDate: vi.fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    };
    const store = createStore(scoreApi);
    const nextDate = '2026-05-19';

    store.openBreakdownForDate(row.metric_date);
    store.openBreakdownForDate(nextDate);
    first.next(breakdown);
    second.next({ ...breakdown, date: nextDate });

    expect(store.selectedDate()).toBe(nextDate);
    expect(store.breakdown()?.date).toBe(nextDate);
  });

  it('cancels in-flight recalculation when the breakdown closes', () => {
    const recalculation = new Subject<DailyScoreBreakdown>();
    const scoreApi = {
      getForDate: vi.fn().mockReturnValue(of(breakdown)),
      recalculate: vi.fn().mockReturnValue(recalculation),
    };
    const store = createStore(scoreApi);
    store.openBreakdownForDate(row.metric_date);
    store.recalculateSelectedDate();

    store.closeBreakdown();
    recalculation.next({ ...breakdown, score: { ...breakdown.score, appTotal: 999 } });

    expect(store.selectedDate()).toBeNull();
    expect(store.breakdown()).toBeNull();
    expect(store.recalculationState()).toBe('idle');
  });

  it('saves manual facts, updates the selected breakdown, and refreshes the summary', () => {
    const manual = { ...breakdown, scoreStatus: 'manual' as const };
    const scoreApi = {
      getForDate: vi.fn().mockReturnValue(of(breakdown)),
      saveManualFacts: vi.fn().mockReturnValue(of(manual)),
    };
    const api = { dailySummary: vi.fn().mockReturnValue(of([row])) };
    const store = createStore(scoreApi, api);
    store.openManualEntry(row.metric_date);
    const input = {
      steps: 1000,
      runIndoorM: 1000,
      runOutdoorM: 3000,
      runUnspecifiedM: 0,
      bikeIndoorM: 0,
      bikeOutdoorM: 0,
      bikeUnspecifiedM: 0,
      swimM: 0,
      workoutPoints: 10,
      bonusPoints: 5,
    };

    store.saveManualFacts(input);

    expect(scoreApi.saveManualFacts).toHaveBeenCalledWith(row.metric_date, input);
    expect(store.breakdown()).toEqual(manual);
    expect(store.manualSaveState()).toBe('idle');
    expect(api.dailySummary).toHaveBeenCalledTimes(1);
  });

  it('treats a missing breakdown as a valid blank manual-entry state', () => {
    const scoreApi = {
      getForDate: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 404,
        error: { code: 'DAILY_SCORE_NOT_FOUND' },
      }))),
    };
    const store = createStore(scoreApi);

    store.openManualEntry('2026-05-19');

    expect(store.selectedDate()).toBe('2026-05-19');
    expect(store.breakdownState()).toBe('loaded');
    expect(store.breakdown()).toBeNull();
    expect(store.manualEditRequestId()).toBe(1);
  });

  it('loads quick-entry facts and preserves a locally added blank date', () => {
    const scoreApi = {
      manualFacts: vi.fn().mockReturnValue(of([{
        date: row.metric_date,
        scoreStatus: 'calculated',
        totalPoints: 25,
        facts: {
          steps: 1000,
          runIndoorM: 1000,
          runOutdoorM: 3000,
          runUnspecifiedM: 0,
          bikeIndoorM: 0,
          bikeOutdoorM: 0,
          bikeUnspecifiedM: 0,
          swimM: 500,
          workoutPoints: 10,
          bonusPoints: 5,
        },
      }])),
    };
    const store = createStore(scoreApi);

    store.showQuickEntry();
    store.addQuickEntryDate('2026-05-19');

    expect(scoreApi.manualFacts).toHaveBeenCalled();
    expect(store.quickEntryRows()[0]).toMatchObject({ date: '2026-05-19', steps: 0 });
    expect(store.quickEntryRows()[1]).toMatchObject({ date: row.metric_date, runOutdoorM: 3000 });
  });

  it('uses the shared durable-job lifecycle before recalculating a Strava-refreshed quick-entry row', async () => {
    vi.useFakeTimers();
    try {
      const enqueue = new Subject<ProviderSyncJob>();
      const recalculated = {
        ...breakdown,
        scoreStatus: 'calculated' as const,
        score: { ...breakdown.score, bonusPoints: 3_000 },
      };
      const scoreApi = {
        manualFacts: vi.fn().mockReturnValue(of([])),
        recalculate: vi.fn().mockReturnValue(of(recalculated)),
      };
      const api = { dailySummary: vi.fn().mockReturnValue(of([row])) };
      const providerApi = {
        connections: vi.fn().mockReturnValue(of([])),
        enqueueSync: vi.fn().mockReturnValue(enqueue),
        syncJob: vi.fn().mockReturnValue(of({ id: 'job-1', status: 'succeeded', progressPercent: 100 })),
      };
      const store = createStore(scoreApi, api, providerApi);
      store.stravaConnection.set({ id: 'connection-1', provider: 'strava', status: 'connected' } as never);
      store.addQuickEntryDate(row.metric_date);

      store.refreshQuickEntryFromStrava(row.metric_date);
      enqueue.next({ id: 'job-1', status: 'queued' } as ProviderSyncJob);
      await vi.runAllTimersAsync();

      expect(providerApi.enqueueSync).toHaveBeenCalledWith('connection-1', 'webhook_refresh', expect.any(Object));
      expect(providerApi.syncJob).toHaveBeenCalledWith('job-1');
      expect(scoreApi.recalculate).toHaveBeenCalledWith(row.metric_date);
      expect(store.quickEntryRows()[0]).toMatchObject({
        date: row.metric_date,
        bonusPoints: 3_000,
        refreshing: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the current imported breakdown visible when recalculation is unavailable', () => {
    const imported = { ...breakdown, scoreStatus: 'imported' as const };
    const scoreApi = {
      getForDate: vi.fn().mockReturnValue(of(imported)),
      recalculate: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 409,
        error: { code: 'STRAVA_DATA_UNAVAILABLE', message: 'No Strava activity is available for the selected date.' },
      }))),
    };
    const store = createStore(scoreApi);
    store.openBreakdownForDate(row.metric_date);

    store.recalculateSelectedDate();

    expect(store.breakdownState()).toBe('loaded');
    expect(store.breakdown()?.scoreStatus).toBe('imported');
    expect(store.recalculationError()).toContain('No Strava activity');
  });

  it('unsubscribes active requests on store teardown', () => {
    const summary = new Subject<DailySummaryRow[]>();
    const quickEntry = new Subject<never[]>();
    const api = { dailySummary: vi.fn().mockReturnValue(summary) };
    const scoreApi = { manualFacts: vi.fn().mockReturnValue(quickEntry) };
    const store = createStore(scoreApi, api);

    store.loadRows();
    store.loadQuickEntryRows();
    expect(summary.observed).toBe(true);
    expect(quickEntry.observed).toBe(true);

    store.ngOnDestroy();

    expect(summary.observed).toBe(false);
    expect(quickEntry.observed).toBe(false);
  });
});

function createStore(
  scoreApi: Record<string, unknown>,
  api: Record<string, unknown> = { dailySummary: vi.fn().mockReturnValue(of([])) },
  providerApi: Record<string, unknown> = { connections: vi.fn().mockReturnValue(of([])) },
): DailyLogStore {
  return new DailyLogStore(
    api as unknown as ApiService,
    scoreApi as unknown as ScoreBreakdownApiService,
    providerApi as unknown as ProviderApiService,
  );
}
