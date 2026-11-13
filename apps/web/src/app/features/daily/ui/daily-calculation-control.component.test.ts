// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DailyCalculationJob, DailyCalculationState } from '../model/daily-calculation.models';
import { DailyCalculationStore } from '../state/daily-calculation.store';
import { DailyCalculationControlComponent } from './daily-calculation-control.component';

const queued: DailyCalculationJob = {
  id: 'job', from: '2026-11-04', to: '2026-11-13', nextDate: '2026-11-04',
  processedDays: 0, totalDays: 10, status: 'queued', errorCode: null, attemptCount: 0,
};
const done: DailyCalculationJob = { ...queued, nextDate: '2026-11-14', processedDays: 10, status: 'succeeded' };
const state: DailyCalculationState = {
  cursor: { startDate: '2026-11-04', completedThrough: '2026-11-12', timeZone: 'Europe/Copenhagen' },
  nextDate: '2026-11-13', activeJob: null, latestJob: null,
};

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

function render(latestJob: DailyCalculationJob | null = null) {
  const api = {
    state: vi.fn().mockReturnValue(of({ ...state, latestJob })),
    start: vi.fn().mockReturnValue(of(queued)),
    retry: vi.fn().mockReturnValue(of(queued)),
    job: vi.fn().mockReturnValue(of(done)),
  };
  const store = new DailyCalculationStore(api as never);
  TestBed.configureTestingModule({ imports: [DailyCalculationControlComponent] });
  TestBed.overrideComponent(DailyCalculationControlComponent, {
    set: { providers: [{ provide: DailyCalculationStore, useValue: store }] },
  });
  const fixture = TestBed.createComponent(DailyCalculationControlComponent);
  fixture.detectChanges();
  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  return { fixture, button, api, store };
}

describe('Overview Calculate all control', () => {
  it('shows a single button without the cursor, progress, or check-status chrome', () => {
    const { fixture, button } = render();
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(1);
    expect(button().textContent?.trim()).toBe('Calculate all');
    expect(fixture.nativeElement.querySelector('progress')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Completed through');
    expect(fixture.nativeElement.textContent).not.toContain('Today stays provisional');
    expect(fixture.nativeElement.textContent).not.toContain('Check calculation status');
  });

  it('shows calculating while running and returns to the same button after success', async () => {
    vi.useFakeTimers();
    const { fixture, button, api } = render();
    button().click();
    fixture.detectChanges();
    expect(api.start).toHaveBeenCalledOnce();
    expect(button().textContent?.trim()).toBe('Calculating…');
    expect(button().disabled).toBe(true);
    await vi.runAllTimersAsync();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(1);
    expect(button().textContent?.trim()).toBe('Calculate all');
    expect(button().disabled).toBe(false);
  });

  it('uses that same button to retry a failed calculation and shows failure details only then', () => {
    const failed: DailyCalculationJob = {
      ...queued, status: 'failed', errorCode: 'DAILY_DATA_UNAVAILABLE', nextDate: '2026-11-06',
    };
    const { fixture, button, api } = render(failed);
    expect(button().textContent?.trim()).toBe('Retry calculation');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('2026-11-06');
    button().click();
    expect(api.retry).toHaveBeenCalledWith('job');
    expect(api.start).not.toHaveBeenCalled();
  });

  it('recovers an ambiguous request by rechecking status, never sending a duplicate POST', () => {
    const { fixture, button, api } = render();
    api.start.mockReturnValueOnce(throwError(() => new Error('timeout')));
    button().click();
    fixture.detectChanges();
    expect(button().textContent?.trim()).toBe('Check status');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Could not confirm');
    button().click();
    fixture.detectChanges();
    expect(api.state).toHaveBeenCalledTimes(2);
    expect(api.start).toHaveBeenCalledOnce();
    expect(button().textContent?.trim()).toBe('Calculate all');
  });
});
