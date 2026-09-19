import '@angular/compiler';
import type { Router } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { DailyApiService } from './features/daily/data-access/daily-api.service';
import type { DailySummaryRow } from './features/daily/model/daily.models';
import { DailyLogComponent } from './daily-log.component';
import { DailyLogStore } from './features/daily/state/daily-log.store';
import type { ProviderApiService } from './provider-api.service';
import type { ScoreBreakdownApiService } from './score-breakdown-api.service';

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

describe('DailyLogComponent', () => {
  it('initializes feature state when the route page starts', () => {
    const { component, store } = createComponent();
    const initialize = vi.spyOn(store, 'initialize');

    component.ngOnInit();

    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it('forwards UI intents to feature state', () => {
    const { component, store } = createComponent();
    const openBreakdown = vi.spyOn(store, 'openBreakdown');
    const setQuickRange = vi.spyOn(store, 'setQuickRange');
    const showQuickEntry = vi.spyOn(store, 'showQuickEntry');

    component.openBreakdown(row);
    component.setQuickRange('1m');
    component.showQuickEntry();

    expect(openBreakdown).toHaveBeenCalledWith(row);
    expect(setQuickRange).toHaveBeenCalledWith('1m');
    expect(showQuickEntry).toHaveBeenCalledTimes(1);
  });

  it('keeps route navigation in the page while selected-day workflow state stays in the store', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const { component, store } = createComponent(router);
    store.selectedDate.set(row.metric_date);

    component.openFullDay();
    expect(router.navigate).toHaveBeenCalledWith(['/daily', row.metric_date], { queryParams: undefined });

    component.openFullDay(true);
    expect(router.navigate).toHaveBeenLastCalledWith(['/daily', row.metric_date], { queryParams: { edit: 'true' } });
  });

  it('does not navigate when no day is selected', () => {
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const { component } = createComponent(router);

    component.openFullDay();

    expect(router.navigate).not.toHaveBeenCalled();
  });
});

function createComponent(
  router: { navigate: ReturnType<typeof vi.fn> } = { navigate: vi.fn().mockResolvedValue(true) },
): { component: DailyLogComponent; store: DailyLogStore } {
  const api = { dailySummary: vi.fn().mockReturnValue(of([])) };
  const scoreApi = {
    getForDate: vi.fn().mockReturnValue(of(null)),
    manualFacts: vi.fn().mockReturnValue(of([])),
  };
  const providerApi = { connections: vi.fn().mockReturnValue(of([])) };
  const store = new DailyLogStore(
    api as unknown as DailyApiService,
    scoreApi as unknown as ScoreBreakdownApiService,
    providerApi as unknown as ProviderApiService,
  );

  return {
    component: new DailyLogComponent(store, router as unknown as Router),
    store,
  };
}
