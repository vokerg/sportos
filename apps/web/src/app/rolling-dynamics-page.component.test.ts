import '@angular/compiler';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { DynamicsApiService } from './features/dynamics/data-access/dynamics-api.service';
import type { RollingDynamicsResponse } from './features/dynamics/model/dynamics.models';
import { RollingDynamicsPageComponent } from './rolling-dynamics-page.component';

const response: RollingDynamicsResponse = {
  range: { from: '2026-01-01', to: '2026-01-31' }, metric: 'run', unit: 'metres', windows: [30, 365],
  points: [{ date: '2026-01-31', dailyValue: 0, windows: { 30: { total: 42_195, calendarDayAverage: 1_406.5, activeDays: 28, recordedDays: 30, windowDays: 30, complete: true }, 365: { total: 42_195, calendarDayAverage: 115.6, activeDays: 120, recordedDays: 31, windowDays: 365, complete: false } } }],
  scoreContributions: { 30: { windowDays: 30, categories: ['run', 'bonus'], points: [{ date: '2026-01-31', contributions: { run: 120, bonus: 10 }, total: 130 }] } },
};

describe('RollingDynamicsPageComponent', () => {
  it('loads metric and windows from the URL and preserves controls on apply', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', metric: 'run', windows: '30,365', measure: 'recordedDayAverage' }));
    const api = { rollingDynamics: vi.fn().mockReturnValue(of(response)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = new RollingDynamicsPageComponent(api as unknown as DynamicsApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    component.ngOnInit();

    expect(api.rollingDynamics).toHaveBeenCalledTimes(8);
    expect(api.rollingDynamics).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31', metric: 'run', windows: [30, 365] });
    expect(component.state()).toBe('loaded');
    expect(component.latestValue(30)).toBe('1.41 km');
    expect(component.latestCoverage(365)).toContain('incomplete');
    expect(component.quickRange()).toBe('ytd');

    component.setMetric('bike');
    component.toggleWindow(7, true);
    component.apply();
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ metric: 'bike', windows: '7,30,365' }) }));
  });

  it('applies Daily Log-style quick ranges and marks edited dates custom', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', metric: 'run', windows: '30' }));
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = new RollingDynamicsPageComponent(
      { rollingDynamics: vi.fn().mockReturnValue(of({ ...response, windows: [30] })) } as unknown as DynamicsApiService,
      { queryParamMap: params } as unknown as ActivatedRoute,
      router as unknown as Router,
    );
    try {
      component.ngOnInit();

      component.setQuickRange('3m');
      expect(component.quickRange()).toBe('3m');
      expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({
        queryParams: expect.objectContaining({ from: component.from(), to: component.to() }),
      }));

      component.setQuickRange('all');
      expect(component.quickRange()).toBe('all');
      expect(component.from()).toBe('2016-09-11');
      expect(component.to()).toBe('2026-09-18');
      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
        queryParams: expect.objectContaining({ from: '2016-09-11', to: '2026-09-18' }),
      }));

      component.setFrom('2026-05-01');
      expect(component.quickRange()).toBe('custom');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not allow the last trailing window to be removed', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', windows: '30' }));
    const component = new RollingDynamicsPageComponent(
      { rollingDynamics: vi.fn().mockReturnValue(of({ ...response, windows: [30] })) } as unknown as DynamicsApiService,
      { queryParamMap: params } as unknown as ActivatedRoute,
      { navigate: vi.fn() } as unknown as Router,
    );
    component.ngOnInit();
    component.toggleWindow(30, false);
    expect(component.windows()).toEqual([30]);
    expect(component.selectionMessage()).toContain('at least one');
  });

  it('offers active-day frequency for activities but not official score', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', metric: 'run', windows: '30', measure: 'activeDays' }));
    const component = new RollingDynamicsPageComponent(
      { rollingDynamics: vi.fn().mockReturnValue(of({ ...response, windows: [30] })) } as unknown as DynamicsApiService,
      { queryParamMap: params } as unknown as ActivatedRoute,
      { navigate: vi.fn() } as unknown as Router,
    );

    component.ngOnInit();
    expect(component.measure()).toBe('activeDays');
    expect(component.latestValue(30)).toBe('28 days');
    expect(component.latestLabel(30)).toBe('Active days in last 30');

    component.setMetric('score');
    expect(component.measure()).toBe('total');
    component.setMeasure('activeDays');
    expect(component.measure()).toBe('total');
  });
});
