import '@angular/compiler';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, DynamicsResponse } from './api.service';
import { MonthlyStatsPageComponent } from './monthly-stats-page.component';

const response: DynamicsResponse = {
  range: { from: '2026-01-01', to: '2026-02-28' }, granularity: 'monthly', metrics: ['score', 'run'],
  metricUnits: { score: 'points', steps: 'steps', run: 'metres', bike: 'metres', swim: 'metres', workout: 'points', power: 'points' },
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

    component.toggleMetric('bike', true);
    component.apply();
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ metrics: 'score,run,bike' }) }));
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
});
