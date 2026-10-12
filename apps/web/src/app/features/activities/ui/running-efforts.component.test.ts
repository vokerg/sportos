// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RunningEffortsComponent } from './running-efforts.component';
import { effortTime, type RunningEfforts } from '../model/running-efforts.models';
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
const data: RunningEfforts = { targets: [5000, 21097.5], providers: [
  { provider: 'strava', state: 'current', projectedAt: '2026-01-01', algorithmVersion: 1, efforts: [
    { targetDistanceM: 5000, method: 'summary_estimate', status: 'estimated', reason: 'streams_not_retained', durationS: 1475.4, sourceDistanceM: 10000, coverageDistanceM: 10000, startOffsetS: null, endOffsetS: null, pausePolicy: 'summary_moving', pauseCoverage: 'summary' },
    { targetDistanceM: 21097.5, method: 'summary_estimate', status: 'unavailable', reason: 'too_short', durationS: null, sourceDistanceM: 10000, coverageDistanceM: 10000, startOffsetS: null, endOffsetS: null, pausePolicy: 'summary_moving', pauseCoverage: 'summary' }] },
  { provider: 'garmin', state: 'current', projectedAt: '2026-01-02', algorithmVersion: 1, efforts: [
    { targetDistanceM: 5000, method: 'fit_calculated', status: 'calculated', reason: null, durationS: 1422.1, sourceDistanceM: 10100, coverageDistanceM: 10100, startOffsetS: 120, endOffsetS: 1600, pausePolicy: 'timer_events', pauseCoverage: 'validated' },
    { targetDistanceM: 21097.5, method: 'fit_calculated', status: 'unavailable', reason: 'too_short', durationS: null, sourceDistanceM: 10100, coverageDistanceM: 10100, startOffsetS: null, endOffsetS: null, pausePolicy: 'timer_events', pauseCoverage: 'validated' }] },
] };
function render(value = data, loading = false) {
  const fixture = TestBed.createComponent(RunningEffortsComponent);
  Object.defineProperty(fixture.componentInstance, 'data', { value: signal(value) });
  Object.defineProperty(fixture.componentInstance, 'loading', { value: signal(loading) });
  Object.defineProperty(fixture.componentInstance, 'error', { value: signal('') });
  fixture.detectChanges(); return fixture;
}
describe('running effort source comparison', () => {
  it('keeps estimates and measured provider results visibly distinct with pause coverage', () => {
    const el = render().nativeElement as HTMLElement; const cells = el.querySelectorAll('tbody tr:first-child td');
    expect(cells[0].textContent).toContain('24:35'); expect(cells[0].textContent).toContain('Estimated'); expect(cells[0].textContent).toContain('Strava summary · average pace');
    expect(cells[1].textContent).toContain('23:42'); expect(cells[1].textContent).toContain('Calculated'); expect(cells[1].textContent).toContain('Garmin FIT · timer-active time');
    expect(el.textContent).toContain('21.1 km'); expect(el.textContent).toContain('Recorded distance is too short'); expect(el.textContent).toContain('not certified personal records');
    expect(el.querySelector('details')?.textContent).toContain('pause coverage: validated'); expect(el.textContent).toContain('Fetch Strava detail');
  });
  it('hides old durations in stale or failed state while preserving independent sources', () => {
    const el = render({ ...data, providers: data.providers.map(p => p.provider === 'strava' ? { ...p, state: 'stale' } : { ...p, state: 'failed' }) }).nativeElement as HTMLElement;
    expect(el.textContent).toContain('Stale'); expect(el.textContent).toContain('Failed'); expect(el.querySelectorAll('td strong')).toHaveLength(0);
  });
  it('qualifies calculated results with incomplete continuous stream coverage', () => {
    const el = render({ ...data, providers: data.providers.map(p => p.provider === 'strava' ? { ...p, algorithmVersion: 2, efforts: p.efforts.map(e => e.targetDistanceM === 5000 ? { ...e, method: 'stream_calculated', status: 'calculated', reason: 'partial_stream_coverage' } : e) } : p) }).nativeElement as HTMLElement;
    const cell = el.querySelector('tbody td')!;
    expect(cell.textContent).toContain('Calculated'); expect(cell.textContent).toContain('Fastest window within continuous retained sections; recording gaps are excluded.');
  });
  it('displays equal times independently and emits only an explicit retained intent', () => {
    const fixture = render({ ...data, providers: data.providers.map(p => ({ ...p, efforts: p.efforts.map(e => e.targetDistanceM === 5000 ? { ...e, durationS: 1475.4 } : e) })) });
    expect(fixture.nativeElement.querySelectorAll('td strong')).toHaveLength(2);
    const emit = vi.spyOn(fixture.componentInstance.reprocess, 'emit'); expect(emit).not.toHaveBeenCalled(); fixture.nativeElement.querySelector('button').click(); expect(emit).toHaveBeenCalledTimes(1);
  });
  it('prevents repeated clicks during calculation and rounds only the display', () => {
    expect(render(data, true).nativeElement.querySelector('button').disabled).toBe(true);
    expect(effortTime(3599.7)).toBe('1:00:00'); expect(effortTime(null)).toBe('—'); expect(data.providers[0].efforts[0].durationS).toBe(1475.4);
  });
});
