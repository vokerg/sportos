import '@angular/compiler';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ApiService, RollingDynamicsResponse } from './api.service';
import { RollingDynamicsPageComponent } from './rolling-dynamics-page.component';

const response: RollingDynamicsResponse = {
  range: { from: '2026-01-01', to: '2026-01-31' }, metric: 'run', unit: 'metres', windows: [30, 365],
  points: [{ date: '2026-01-31', dailyValue: 0, windows: { 30: { total: 42_195, calendarDayAverage: 1_406.5, recordedDays: 30, windowDays: 30, complete: true }, 365: { total: 42_195, calendarDayAverage: 115.6, recordedDays: 31, windowDays: 365, complete: false } } }],
};

describe('RollingDynamicsPageComponent', () => {
  it('loads metric and windows from the URL and preserves controls on apply', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', metric: 'run', windows: '30,365', measure: 'recordedDayAverage' }));
    const api = { rollingDynamics: vi.fn().mockReturnValue(of(response)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = new RollingDynamicsPageComponent(api as unknown as ApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    component.ngOnInit();

    expect(api.rollingDynamics).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31', metric: 'run', windows: [30, 365] });
    expect(component.state()).toBe('loaded');
    expect(component.latestValue(30)).toBe('1.41 km');
    expect(component.latestCoverage(365)).toContain('incomplete');

    component.setMetric('bike');
    component.toggleWindow(10, true);
    component.apply();
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ metric: 'bike', windows: '10,30,365' }) }));
  });

  it('does not allow the last trailing window to be removed', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', windows: '30' }));
    const component = new RollingDynamicsPageComponent(
      { rollingDynamics: vi.fn().mockReturnValue(of({ ...response, windows: [30] })) } as unknown as ApiService,
      { queryParamMap: params } as unknown as ActivatedRoute,
      { navigate: vi.fn() } as unknown as Router,
    );
    component.ngOnInit();
    component.toggleWindow(30, false);
    expect(component.windows()).toEqual([30]);
    expect(component.selectionMessage()).toContain('at least one');
  });
});
