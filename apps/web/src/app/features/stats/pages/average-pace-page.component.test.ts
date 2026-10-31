import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import { PaceSpeedApiService } from '../data-access/pace-speed-api.service';
import type { PaceSpeedResponse } from '../model/pace-speed.models';
import { AveragePacePageComponent } from './average-pace-page.component';

const sample: PaceSpeedResponse = {
  source: 'strava', range: { from: '2026-01-01', to: '2026-01-31' }, sport: 'run', granularity: 'weekly', threshold: 360,
  buckets: [{ key: '2025-12-29', totalDistanceM: 25000, includedDistanceM: 18000,
    includedTimeS: 5400, missingTimeDistanceM: 2000, activities: 4, includedActivities: 3, value: 300 }],
};

describe('AveragePacePageComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to enabled run exclusion at 6:00/km without saved or URL overrides', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31' }));
    const api = { trends: vi.fn().mockReturnValue(of(sample)) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute,
      { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router);
    component.ngOnInit();
    expect(component.filterEnabled()).toBe(true);
    expect(component.threshold()).toBe(360);
    expect(api.trends).toHaveBeenCalledWith(expect.objectContaining({ sport: 'run', threshold: 360 }));
    component.ngOnDestroy();
  });
  it('loads filtered run trends with the shared URL-backed range and default 6:00 pace', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', sport: 'run', filter: '1', threshold: '360' }));
    const api = { trends: vi.fn().mockReturnValue(of(sample)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    component.ngOnInit();
    expect(api.trends).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31', sport: 'run', granularity: 'weekly', threshold: 360 });
    expect(component.state()).toBe('loaded');
    expect(component.rows()[0]?.value).toBe(300);
    expect(component.filteredDistanceM(component.rows()[0]!)).toBe(5000);
    expect(component.activityQuery('2025-12-29')).toEqual({ from: '2026-01-01', to: '2026-01-04', activityType: 'run', source: 'strava' });
    component.setFilterEnabled(false);
    expect(router.navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ filter: '0', threshold: 360 }) }));
    component.ngOnDestroy();
  });

  it('supports bike and swim with optional filters and selectable granularity', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', sport: 'bike', filter: '0', granularity: 'monthly', threshold: '15' }));
    const api = { trends: vi.fn().mockReturnValue(of({ ...sample, sport: 'bike' })) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    component.ngOnInit();
    expect(api.trends).toHaveBeenCalledWith(expect.objectContaining({ sport: 'bike', granularity: 'monthly', threshold: null }));
    component.setSport('swim');
    expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ sport: 'swim', threshold: 180 }) }));
    component.ngOnDestroy();
  });

  it('keeps loaded units and drilldowns tied to the response while controls are edited', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31' }));
    const api = { trends: vi.fn().mockReturnValue(of(sample)) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute,
      { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router);
    component.ngOnInit();
    component.setFrom('2026-01-20');
    component.setGranularity('monthly');
    component.setSport('bike');
    expect(component.formatValue(300)).toBe('5:00 /km');
    expect(component.bucketLabel('2025-12-29')).toBe('2025-12-29');
    expect(component.activityQuery('2025-12-29')).toEqual({ from: '2026-01-01', to: '2026-01-04', activityType: 'run', source: 'strava' });
    component.ngOnDestroy();
  });

  it('cancels replaced requests, invalid submissions and requests on destroy', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31' }));
    const first = new Subject<PaceSpeedResponse>();
    const second = new Subject<PaceSpeedResponse>();
    const third = new Subject<PaceSpeedResponse>();
    const api = { trends: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute,
      { navigate: vi.fn().mockResolvedValue(true) } as unknown as Router);
    component.ngOnInit();
    params.next(convertToParamMap({ from: '2026-02-01', to: '2026-02-28' }));
    expect(first.observed).toBe(false);
    first.next(sample);
    expect(component.data()).toBeNull();
    component.setFrom('2026-03-01');
    component.apply();
    expect(second.observed).toBe(false);
    second.next(sample);
    expect(component.state()).toBe('error');
    expect(component.data()).toBeNull();
    component.setFrom('2026-02-01');
    component.load();
    expect(third.observed).toBe(true);
    component.ngOnDestroy();
    expect(third.observed).toBe(false);
  });

  it('refreshes when Apply navigates to the same URL and supports empty results', async () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31' }));
    const api = { trends: vi.fn().mockReturnValue(of({ ...sample, buckets: [] })) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute,
      { navigate: vi.fn().mockResolvedValue(false) } as unknown as Router);
    component.ngOnInit();
    expect(component.state()).toBe('empty');
    component.apply();
    await Promise.resolve();
    expect(api.trends).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
    component.apply();
    await Promise.resolve();
    expect(api.trends).toHaveBeenCalledTimes(2);
  });

  it('surfaces API failures and invalid date ranges', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', filter: '0' }));
    const api = { trends: vi.fn().mockReturnValue(throwError(() => new Error('offline'))) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    component.ngOnInit();
    expect(component.state()).toBe('error');
    component.setFrom('2026-03-01');
    component.apply();
    expect(component.errorMessage()).toContain('on or before');
    expect(router.navigate).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });
});

function createComponent(api: PaceSpeedApiService, route: ActivatedRoute, router: Router) {
  const injector = Injector.create({ providers: [
    { provide: ColorSchemeService, useValue: { chartTheme: () => ({}) } },
    { provide: PaceSpeedApiService, useValue: api },
    { provide: ActivatedRoute, useValue: route },
    { provide: Router, useValue: router },
  ] });
  return runInInjectionContext(injector, () => new AveragePacePageComponent());
}
