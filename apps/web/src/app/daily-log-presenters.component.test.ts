import '@angular/compiler';
import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import type { GridReadyEvent } from 'ag-grid-community';
import { describe, expect, it, vi } from 'vitest';
import type { DailySummaryRow } from './api.service';
import { DailyLogActionsComponent } from './daily-log-actions.component';
import { DailyLogFiltersComponent } from './daily-log-filters.component';
import { DailyLogGridComponent } from './daily-log-grid.component';
import { DailyLogTrendComponent } from './daily-log-trend.component';

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
  score_status: 'calculated',
};

describe('daily log presentation components', () => {
  it('exposes filter and explicit-action intents without API dependencies', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const { filters, actions } = runInInjectionContext(injector, () => ({
      filters: new DailyLogFiltersComponent(),
      actions: new DailyLogActionsComponent(),
    }));
    const intents: string[] = [];

    filters.quickRangeChange.subscribe((value) => intents.push(`range:${value}`));
    filters.apply.subscribe(() => intents.push('apply'));
    filters.reset.subscribe(() => intents.push('reset'));
    actions.dateChange.subscribe((value) => intents.push(`date:${value}`));
    actions.recalculate.subscribe(() => intents.push('recalculate'));
    actions.manualEntry.subscribe(() => intents.push('manual'));

    filters.quickRangeChange.emit('1m');
    filters.apply.emit();
    filters.reset.emit();
    actions.dateChange.emit('2026-05-18');
    actions.recalculate.emit();
    actions.manualEntry.emit();

    expect(intents).toEqual([
      'range:1m',
      'apply',
      'reset',
      'date:2026-05-18',
      'recalculate',
      'manual',
    ]);
    injector.destroy();
  });

  it('keeps AG Grid configuration and row actions inside the grid presenter', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const grid = runInInjectionContext(injector, () => new DailyLogGridComponent());
    const setGridOption = vi.fn();
    const opened: DailySummaryRow[] = [];
    grid.openBreakdown.subscribe((value) => opened.push(value));

    grid.onGridReady({ api: { setGridOption } } as unknown as GridReadyEvent<DailySummaryRow>);
    grid.setPageSize('200');
    grid.gridContext.openBreakdown(row);

    expect(grid.pageSize()).toBe(200);
    expect(setGridOption).toHaveBeenLastCalledWith('paginationPageSize', 200);
    expect(opened).toEqual([row]);

    grid.setPageSize('50');
    expect(grid.pageSize()).toBe(200);
    expect(setGridOption).toHaveBeenLastCalledWith('paginationPageSize', 200);
    injector.destroy();
  });

  it('constructs trend and grid leaves with empty presentation state', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const { trend, grid } = runInInjectionContext(injector, () => ({
      trend: new DailyLogTrendComponent(),
      grid: new DailyLogGridComponent(),
    }));

    expect(trend.rows()).toEqual([]);
    expect(trend.latest()).toBeUndefined();
    expect(grid.rows()).toEqual([]);
    expect(grid.paginationPageSizeSelector).toEqual([100, 200, 365]);
    injector.destroy();
  });
});
