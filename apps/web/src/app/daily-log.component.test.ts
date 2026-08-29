import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, DailySummaryRow } from './api.service';
import { DailyLogComponent } from './daily-log.component';
import type { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

const row: DailySummaryRow = {
  metric_date: '2026-05-18', steps: 12_345, run_m: 5_000, bike_m: 0, swim_m: 0,
  workout_points: 0, power_points: 0, base_points: 20, bonus_points: 5, total_points: 25,
  excel_all_points: 24, points_delta_vs_excel: 1, avg_10d: 20, avg_20d: 19, avg_30d: 18,
  avg_60d: 17, avg_365d: 16, score_status: 'calculated',
};

const breakdown: DailyScoreBreakdown = {
  date: row.metric_date,
  recomputedAt: '2026-05-18T12:00:00.000Z',
  scoreStatus: 'calculated',
  facts: { steps: row.steps, runM: row.run_m, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 25, excelTotal: 24, delta: 1, baseTotal: 20, bonusTotal: 5, ledgerTotal: 25 },
  sourceRecord: null,
  activities: [],
  sourceRecords: [],
  ledger: [],
};

describe('DailyLogComponent cockpit workflow', () => {
  it('loads filtered rows and represents empty/error states explicitly', () => {
    const api = { dailySummary: vi.fn().mockReturnValueOnce(of([row])).mockReturnValueOnce(of([])) };
    const component = createComponent({ getForDate: vi.fn() }, api);

    component.ngOnInit();
    expect(component.summaryState()).toBe('loaded');
    expect(component.rows()).toEqual([row]);

    component.loadRows();
    expect(component.summaryState()).toBe('empty');
  });

  it('rejects a reversed client range without issuing a request', () => {
    const api = { dailySummary: vi.fn().mockReturnValue(of([])) };
    const component = createComponent({ getForDate: vi.fn() }, api);
    component.from.set('2026-05-20');
    component.to.set('2026-05-18');

    component.applyFilters();

    expect(component.summaryState()).toBe('error');
    expect(component.summaryError()).toContain('on or before');
    expect(api.dailySummary).not.toHaveBeenCalled();
  });

  it('renders an actionable summary API failure', () => {
    const api = { dailySummary: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'Database unavailable.' } }))) };
    const component = createComponent({ getForDate: vi.fn() }, api);
    component.loadRows();
    expect(component.summaryState()).toBe('error');
    expect(component.summaryError()).toBe('Database unavailable.');
  });

  it('loads a selected row and exposes the persisted breakdown', () => {
    const scoreApi = { getForDate: vi.fn().mockReturnValue(of(breakdown)) };
    const component = createComponent(scoreApi);
    component.openBreakdown(row);
    expect(scoreApi.getForDate).toHaveBeenCalledWith(row.metric_date);
    expect(component.selectedDate()).toBe(row.metric_date);
    expect(component.breakdownState()).toBe('loaded');
    expect(component.breakdown()).toEqual(breakdown);
  });

  it('keeps a missing Excel total distinct from a zero delta', () => {
    const noExcel = { ...breakdown, score: { ...breakdown.score, excelTotal: null, delta: null } } satisfies DailyScoreBreakdown;
    const component = createComponent({ getForDate: vi.fn().mockReturnValue(of(noExcel)) });
    component.openBreakdown(row);
    expect(component.breakdown()?.score.excelTotal).toBeNull();
    expect(component.breakdown()?.score.delta).toBeNull();
  });

  it('explicitly recalculates the selected date and refreshes the summary', () => {
    const recalculated = {
      ...breakdown,
      scoreStatus: 'calculated' as const,
      score: { ...breakdown.score, appTotal: 6000, delta: 5976, baseTotal: 5000, bonusTotal: 1000, ledgerTotal: 6000 },
    };
    const scoreApi = {
      getForDate: vi.fn().mockReturnValue(of(breakdown)),
      recalculate: vi.fn().mockReturnValue(of(recalculated)),
    };
    const api = { dailySummary: vi.fn().mockReturnValue(of([row])) };
    const component = createComponent(scoreApi, api);
    component.openBreakdown(row);

    component.recalculateSelectedDate();

    expect(scoreApi.recalculate).toHaveBeenCalledWith(row.metric_date);
    expect(component.breakdown()).toEqual(recalculated);
    expect(component.recalculationState()).toBe('idle');
    expect(api.dailySummary).toHaveBeenCalledTimes(1);
  });

  it('keeps the imported breakdown visible when Strava recalculation is unavailable', () => {
    const scoreApi = {
      getForDate: vi.fn().mockReturnValue(of({ ...breakdown, scoreStatus: 'imported' as const })),
      recalculate: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 409,
        error: { code: 'STRAVA_DATA_UNAVAILABLE', message: 'No Strava activity is available for the selected date.' },
      }))),
    };
    const component = createComponent(scoreApi);
    component.openBreakdown(row);

    component.recalculateSelectedDate();

    expect(component.breakdownState()).toBe('loaded');
    expect(component.breakdown()?.scoreStatus).toBe('imported');
    expect(component.recalculationError()).toContain('No Strava activity');
  });

  it('shows a recalculation failure when the selected date has no saved breakdown', () => {
    const message = 'No Strava activity is available for the selected date.';
    const scoreApi = {
      getForDate: vi.fn(),
      recalculate: vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({
        status: 409,
        error: { code: 'STRAVA_DATA_UNAVAILABLE', message },
      }))),
    };
    const component = createComponent(scoreApi);

    component.recalculateSelectedDate('2026-05-19');

    expect(component.breakdownState()).toBe('error');
    expect(component.breakdownError()).toBe(message);
    expect(component.recalculationError()).toBe(message);
  });

  it('cancels an in-flight recalculation when the breakdown is closed', () => {
    const recalculation = new Subject<DailyScoreBreakdown>();
    const scoreApi = {
      getForDate: vi.fn().mockReturnValue(of(breakdown)),
      recalculate: vi.fn().mockReturnValue(recalculation),
    };
    const component = createComponent(scoreApi);
    component.openBreakdown(row);
    component.recalculateSelectedDate();

    component.closeBreakdown();
    recalculation.next({ ...breakdown, scoreStatus: 'calculated' });

    expect(component.selectedDate()).toBeNull();
    expect(component.breakdown()).toBeNull();
    expect(component.recalculationState()).toBe('idle');
  });

  it('renders an actionable API consistency error and supports retry', () => {
    const scoreApi = {
      getForDate: vi.fn()
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500, error: { code: 'SCORE_BREAKDOWN_INCONSISTENT' } })))
        .mockReturnValueOnce(of(breakdown)),
    };
    const component = createComponent(scoreApi);
    component.openBreakdown(row);
    expect(component.breakdownState()).toBe('error');
    expect(component.breakdownError()).toContain('failed consistency checks');
    component.retryBreakdown();
    expect(scoreApi.getForDate).toHaveBeenCalledTimes(2);
    expect(component.breakdownState()).toBe('loaded');
  });

  it('cancels a previous date request so stale responses cannot replace the selection', () => {
    const first = new Subject<DailyScoreBreakdown>();
    const second = new Subject<DailyScoreBreakdown>();
    const scoreApi = { getForDate: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const component = createComponent(scoreApi);
    const nextRow = { ...row, metric_date: '2026-05-19' };
    component.openBreakdown(row);
    component.openBreakdown(nextRow);
    first.next(breakdown);
    second.next({ ...breakdown, date: nextRow.metric_date });
    expect(component.selectedDate()).toBe(nextRow.metric_date);
    expect(component.breakdown()?.date).toBe(nextRow.metric_date);
  });

  it('returns to the accessible idle state when the panel is closed', () => {
    const component = createComponent({ getForDate: vi.fn().mockReturnValue(of(breakdown)) });
    component.openBreakdown(row);
    component.closeBreakdown();
    expect(component.selectedDate()).toBeNull();
    expect(component.breakdown()).toBeNull();
    expect(component.breakdownState()).toBe('idle');
  });
});

function createComponent(
  scoreApi: { getForDate: ReturnType<typeof vi.fn>; recalculate?: ReturnType<typeof vi.fn> },
  api: { dailySummary: ReturnType<typeof vi.fn> } = { dailySummary: vi.fn().mockReturnValue(of([])) },
): DailyLogComponent {
  return new DailyLogComponent(api as unknown as ApiService, scoreApi as unknown as ScoreBreakdownApiService);
}
