import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, DailySummaryRow } from './api.service';
import { DailyLogComponent } from './daily-log.component';
import type { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

const row: DailySummaryRow = {
  metric_date: '2026-05-18',
  steps: 12_345,
  run_m: 5_000,
  bike_m: 0,
  swim_m: 0,
  workout_points: 0,
  power_points: 0,
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
};

const breakdown: DailyScoreBreakdown = {
  date: row.metric_date,
  recomputedAt: '2026-05-18T12:00:00.000Z',
  facts: { steps: row.steps, runM: row.run_m, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 25, excelTotal: 24, delta: 1, baseTotal: 20, bonusTotal: 5, ledgerTotal: 25 },
  sourceRecord: null,
  ledger: [],
};

describe('DailyLogComponent reconciliation workflow', () => {
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
    const noExcel = {
      ...breakdown,
      score: { ...breakdown.score, excelTotal: null, delta: null },
    } satisfies DailyScoreBreakdown;
    const scoreApi = { getForDate: vi.fn().mockReturnValue(of(noExcel)) };
    const component = createComponent(scoreApi);

    component.openBreakdown(row);

    expect(component.breakdown()?.score.excelTotal).toBeNull();
    expect(component.breakdown()?.score.delta).toBeNull();
  });

  it('renders an actionable API consistency error and supports retry', () => {
    const scoreApi = {
      getForDate: vi
        .fn()
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({
            status: 500,
            error: { code: 'SCORE_BREAKDOWN_INCONSISTENT' },
          })),
        )
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

function createComponent(scoreApi: { getForDate: ReturnType<typeof vi.fn> }): DailyLogComponent {
  const api = { dailySummary: vi.fn().mockReturnValue(of([])) } as unknown as ApiService;
  return new DailyLogComponent(api, scoreApi as unknown as ScoreBreakdownApiService);
}
