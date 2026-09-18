import '@angular/compiler';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, DynamicsResponse } from './api.service';
import { boundedAllTimeRange, quickRangeDates } from './daily-log.view-model';
import { MonthlyStatsPageComponent } from './monthly-stats-page.component';
import { buildMonthlyLedger } from './monthly-stats.view-model';

const response: DynamicsResponse = {
  range: { from: '2026-01-01', to: '2026-02-28' }, granularity: 'monthly', metrics: ['score', 'run'],
  metricUnits: { score: 'points', steps: 'steps', run: 'metres', bike: 'metres', swim: 'metres', workout: 'points', bonus: 'points' },
  monthly: [{ key: '2026-01', from: '2026-01-01', to: '2026-01-31', calendarDays: 31, recordedDays: 1, partial: false, values: { score: { total: 10, recordedDayAverage: 10 }, run: { total: 5_000, recordedDayAverage: 5_000 } } }],
  series: [],
};

describe('MonthlyStatsPageComponent', () => {
  it('loads URL-backed controls and routes an updated selection', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-02-28', granularity: 'monthly', metrics: 'score,run', measure: 'recordedDayAverage', mode: 'indexed' }));
    const api = { monthlyStats: vi.fn().mockReturnValue(of(response)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = new MonthlyStatsPageComponent(api as unknown as ApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);

    component.ngOnInit();
    expect(api.monthlyStats).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-02-28', granularity: 'monthly', metrics: ['score', 'run'] });
    expect(component.state()).toBe('loaded');
    expect(component.measure()).toBe('recordedDayAverage');
    expect(component.mode()).toBe('indexed');
    expect(component.quickRange()).toBe('ytd');

    component.toggleMetric('bike', true);
    component.apply();
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ metrics: 'score,run,bike' }) }));
  });

  it('matches and applies quick date ranges, including the bounded all-time range', () => {
    const oneMonth = quickRangeDates('1m');
    const params = new BehaviorSubject(convertToParamMap({ ...oneMonth, metrics: 'run' }));
    const api = { monthlyStats: vi.fn().mockReturnValue(of(response)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = new MonthlyStatsPageComponent(api as unknown as ApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);

    component.ngOnInit();
    expect(component.quickRange()).toBe('1m');

    component.setQuickRange('all');
    const all = boundedAllTimeRange();
    expect(component.quickRange()).toBe('all');
    expect(component.from()).toBe(all.from);
    expect(component.to()).toBe(all.to);
    expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining(all) }));

    component.setFrom('2026-01-02');
    expect(component.quickRange()).toBe('custom');
  });

  it('enforces one-to-four selected metrics and surfaces API failures', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-02-28', metrics: 'score,steps,run,bike' }));
    const api = { monthlyStats: vi.fn().mockReturnValue(throwError(() => new Error('offline'))) };
    const component = new MonthlyStatsPageComponent(api as unknown as ApiService, { queryParamMap: params } as unknown as ActivatedRoute, { navigate: vi.fn() } as unknown as Router);
    component.ngOnInit();
    expect(component.state()).toBe('error');
    component.toggleMetric('swim', true);
    expect(component.selectionMessage()).toContain('at most four');
    component.selectedMetrics.set(['score']);
    component.toggleMetric('score', false);
    expect(component.selectionMessage()).toContain('at least one');
  });

  it('colors larger monthly values more strongly within each metric and measure', () => {
    const january = response.monthly[0]!;
    const february = {
      ...january,
      key: '2026-02',
      from: '2026-02-01',
      to: '2026-02-28',
      values: { ...january.values, run: { total: 10_000, recordedDayAverage: 10_000 } },
    };
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-02-28', metrics: 'run' }));
    const api = { monthlyStats: vi.fn().mockReturnValue(of({ ...response, monthly: [january, february] })) };
    const component = new MonthlyStatsPageComponent(api as unknown as ApiService, { queryParamMap: params } as unknown as ActivatedRoute, { navigate: vi.fn() } as unknown as Router);

    component.ngOnInit();
    expect(component.cellBackground(january, 'run', 'total')).toBe('rgba(116, 168, 132, 0.10)');
    expect(component.cellBackground(february, 'run', 'total')).toBe('rgba(116, 168, 132, 0.26)');
  });

  it('builds an Excel-style year hierarchy from monthly buckets', () => {
    const january = {
      ...response.monthly[0]!,
      scoreContributions: { bike: 346, run: 206, swim: 4, workout: 113, steps: 160, bonus: 37 },
    };
    const february = {
      ...january,
      key: '2026-02', from: '2026-02-01', to: '2026-02-28',
      values: { ...january.values, score: { total: 20, recordedDayAverage: 20 } },
      scoreContributions: { bike: 200, run: 100, swim: 0, workout: 20, steps: 80, bonus: 10 },
    };

    const ledger = buildMonthlyLedger([january, february]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ year: '2026', recordedDays: 2, calendarDays: 62 });
    expect(ledger[0]?.totals).toMatchObject({ bike: 546, run: 306, swim: 4, workout: 133, steps: 240, bonus: 47, score: 30 });
  });
});
