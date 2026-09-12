import '@angular/compiler';
import type { Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, DailySummaryRow } from './api.service';
import { OverviewPageComponent } from './overview-page.component';
import type { ScoreBreakdownApiService } from './score-breakdown-api.service';
import type { DailyScoreBreakdown } from './score-breakdown.models';

const row: DailySummaryRow = {
  metric_date: '2026-09-11', steps: 5070, run_m: 0, bike_m: 27550, swim_m: 0,
  workout_points: 0, power_points: 2000, base_points: 22978, bonus_points: 2000,
  total_points: 24978, excel_all_points: null, points_delta_vs_excel: null,
  avg_10d: 1000, avg_20d: 900, avg_30d: 800, avg_60d: 700, avg_365d: 600,
  score_status: 'manual',
};
const breakdown: DailyScoreBreakdown = {
  date: row.metric_date, recomputedAt: '2026-09-11T12:00:00.000Z', scoreStatus: 'manual',
  facts: { steps: row.steps, runM: row.run_m, bikeM: row.bike_m, swimM: 0, workoutPoints: 0, powerPoints: 2000 },
  score: { appTotal: row.total_points, excelTotal: null, delta: null, baseTotal: row.base_points, bonusTotal: row.bonus_points, ledgerTotal: row.total_points },
  sourceRecord: null, activities: [], sourceRecords: [], ledger: [],
};

describe('OverviewPageComponent', () => {
  it('loads recent official rows and opens the selected-day sheet', () => {
    const api = { dailySummary: vi.fn().mockReturnValue(of([row])) };
    const scoreApi = { getForDate: vi.fn().mockReturnValue(of(breakdown)) };
    const component = createComponent(api, scoreApi);
    component.ngOnInit();

    component.selectDay(row);

    expect(api.dailySummary).toHaveBeenCalledWith({ limit: 31 });
    expect(component.state()).toBe('loaded');
    expect(scoreApi.getForDate).toHaveBeenCalledWith(row.metric_date);
    expect(component.breakdown()).toEqual(breakdown);
  });

  it('routes the selected day to the complete edit workspace', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = createComponent(
      { dailySummary: vi.fn().mockReturnValue(of([row])) },
      { getForDate: vi.fn().mockReturnValue(of(breakdown)) },
      router,
    );
    component.selectDay(row);

    component.openDay(true);

    expect(router.navigate).toHaveBeenCalledWith(['/daily', row.metric_date], { queryParams: { edit: 'true' } });
  });
});

function createComponent(
  api: { dailySummary: ReturnType<typeof vi.fn> },
  scoreApi: { getForDate: ReturnType<typeof vi.fn> },
  router: { navigate: ReturnType<typeof vi.fn> } = { navigate: vi.fn().mockResolvedValue(true) },
): OverviewPageComponent {
  return new OverviewPageComponent(
    api as unknown as ApiService,
    scoreApi as unknown as ScoreBreakdownApiService,
    router as unknown as Router,
  );
}
