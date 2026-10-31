import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import type { PaceSpeedApiService } from '../data-access/pace-speed-api.service';
import type { PaceSpeedResponse } from '../model/pace-speed.models';
import { AveragePacePageComponent } from './average-pace-page.component';

const sample: PaceSpeedResponse = {
  range: { from: '2026-01-01', to: '2026-01-31' }, sport: 'run', granularity: 'weekly', threshold: 360,
  buckets: [{ key: '2025-12-29', totalDistanceM: 25000, includedDistanceM: 18000,
    includedTimeS: 5400, activities: 4, includedActivities: 3, value: 300 }],
};

describe('AveragePacePageComponent', () => {
  it('loads filtered run trends with the shared URL-backed range and default 6:00 pace', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', sport: 'run', filter: '1', threshold: '360' }));
    const api = { trends: vi.fn().mockReturnValue(of(sample)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = createComponent(api as unknown as PaceSpeedApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    component.ngOnInit();
    expect(api.trends).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31', sport: 'run', granularity: 'weekly', threshold: 360 });
    expect(component.state()).toBe('loaded');
    expect(component.rows()[0]?.value).toBe(300);
    expect(component.notUsed(component.rows()[0]!)).toBe(7000);
    expect(component.activityQuery('2025-12-29')).toEqual({ from: '2026-01-01', to: '2026-01-04', activityType: 'run', source: '' });
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

function createComponent(...args: ConstructorParameters<typeof AveragePacePageComponent>) {
  const injector = Injector.create({ providers: [{ provide: ColorSchemeService, useValue: { chartTheme: () => ({}) } }] });
  return runInInjectionContext(injector, () => new AveragePacePageComponent(...args));
}
