import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { ColorSchemeService } from './core/theme/color-scheme.service';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { DynamicsApiService } from './features/dynamics/data-access/dynamics-api.service';
import type { RollingDynamicsResponse } from './features/dynamics/model/dynamics.models';
import { DynamicsStore } from './features/dynamics/state/dynamics.store';
import { signal } from '@angular/core';
import type { DynamicsHistoryResponse } from './features/dynamics/model/dynamics.models';
import { RollingDynamicsPageComponent } from './features/dynamics/pages/rolling-dynamics-page.component';

const response: RollingDynamicsResponse = {
  range: { from: '2026-01-01', to: '2026-01-31' }, metric: 'run', unit: 'metres', windows: [30, 365],
  points: [{ date: '2026-01-31', dailyValue: 0, windows: { 30: { total: 42_195, calendarDayAverage: 1_406.5, activeDays: 28, recordedDays: 30, windowDays: 30, complete: true }, 365: { total: 42_195, calendarDayAverage: 115.6, activeDays: 120, recordedDays: 31, windowDays: 365, complete: false } } }],
  scoreContributions: { 30: { windowDays: 30, categories: ['run', 'bonus'], points: [{ date: '2026-01-31', contributions: { run: 120, bonus: 10 }, total: 130 }] } },
};

function historyFixture(): DynamicsHistoryResponse {
  const metrics = ['score', 'steps', 'run', 'bike', 'swim', 'workout', 'bonus'] as const;
  const columns = (value: number | null) => Object.fromEntries(metrics.map((metric) => [metric, [value]])) as DynamicsHistoryResponse['daily'];
  return { version: 1, range: response.range, dates: ['2026-01-31'], daily: columns(0), records: [],
    windows: { 30: { totals: columns(42_195), activeDays: columns(28), recordedDays: [30] },
      365: { totals: columns(42_195), activeDays: columns(120), recordedDays: [31] } },
    scoreContributions: response.scoreContributions };
}

describe('RollingDynamicsPageComponent', () => {
  it('loads metric and windows from the URL and preserves controls on apply', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', metric: 'run', windows: '30,365', measure: 'recordedDayAverage' }));
    const api = { rollingDynamics: vi.fn().mockReturnValue(of(response)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const component = createComponent(api as unknown as DynamicsApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    component.ngOnInit();

    expect(api.rollingDynamics).not.toHaveBeenCalled();
    expect(component.store.load).toHaveBeenCalledTimes(1);
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
    const component = createComponent(
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
      expect(component.from()).toBe('2026-01-01');
      expect(component.to()).toBe('2026-01-31');
      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({
        queryParams: expect.objectContaining({ from: '2026-01-01', to: '2026-01-31' }),
      }));

      component.setFrom('2026-05-01');
      expect(component.quickRange()).toBe('custom');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not allow the last trailing window to be removed', () => {
    const params = new BehaviorSubject(convertToParamMap({ from: '2026-01-01', to: '2026-01-31', windows: '30' }));
    const component = createComponent(
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
    const component = createComponent(
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

function createComponent(_api: DynamicsApiService, route: ActivatedRoute, router: Router) {
  const store = { history: signal(historyFixture()), state: signal('loaded'), errorMessage: signal(null), load: vi.fn() };
  const injector = Injector.create({ providers: [
    { provide: ColorSchemeService, useValue: { chartTheme: () => ({}) } },
    { provide: DynamicsStore, useValue: store },
  ] });
  return runInInjectionContext(injector, () => new RollingDynamicsPageComponent(route, router));
}

it('keeps all chart days available, pages table rows, and uses a stable range-wide heat scale', () => {
  const component = createComponent({} as DynamicsApiService, {queryParamMap:of(convertToParamMap({from:'2026-01-01',to:'2026-01-31'}))} as unknown as ActivatedRoute, {navigate:vi.fn()} as unknown as Router);
  component.ngOnInit();
  const fixture = historyFixture();
  fixture.range = {from:'2025-01-01',to:'2026-01-31'};
  fixture.dates = Array.from({length:122},(_,i)=>new Date(Date.UTC(2025,9,i+1)).toISOString().slice(0,10));
  for (const metric of component.aggregateMetrics) {
    fixture.daily[metric] = fixture.dates.map((_,i)=>i);
    fixture.windows[30]!.totals[metric] = fixture.dates.map((_,i)=>i*30);
    fixture.windows[30]!.activeDays[metric] = fixture.dates.map(()=>1);
  }
  fixture.windows[30]!.recordedDays=fixture.dates.map(()=>30);
  component.store.history.set(fixture);
  component.allTableDays.set(true);
  expect(component.data()!.points).toHaveLength(122);
  expect(component.tableRows()[30]).toHaveLength(50);
  expect(component.pageCount()).toBe(3);
  const scale = component.heatRanges(); component.tablePage.set(2);
  expect(component.tableRows()[30]).toHaveLength(22);
  expect(component.tableRows()[30]!.at(-1)?.date).toBe('2025-10-01');
  expect(component.heatRanges()).toBe(scale);
  component.setPageSize('200');expect(component.tablePage()).toBe(0);expect(component.tableRows()[30]).toHaveLength(122);
  component.from.set(fixture.range.from);component.to.set(fixture.range.to);
  expect(component.selectedQuickRange()).toBe('all');
});
