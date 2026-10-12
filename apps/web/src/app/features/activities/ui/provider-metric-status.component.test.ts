// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProviderMetricStatusComponent } from './provider-metric-status.component';
import type { ProviderMetricStatus } from '../model/activity-metrics.models';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
const status = (provider: 'strava' | 'garmin', rawRetained: boolean | null): ProviderMetricStatus => ({
  provider, linked: true, compactRetained: true, rawRetained, state: 'processed', lastProjectedAt: null,
  failureCategory: null, valueCount: 10, missingCount: 0, rejectedCount: 0, compactOnly: rawRetained !== true, missingCategories: [],
});
function render(statuses: ProviderMetricStatus[], expanded = false) {
  const fixture = TestBed.createComponent(ProviderMetricStatusComponent);
  Object.defineProperty(fixture.componentInstance, 'statuses', { value: signal(statuses) });
  Object.defineProperty(fixture.componentInstance, 'expanded', { value: signal(expanded) });
  fixture.detectChanges(); return fixture.nativeElement as HTMLElement;
}
describe('compact provider coverage icons', () => {
  it('shows the shared provider marks with distinct summary/detail indicators and accessible descriptions', () => {
    const el = render([status('strava', false), status('garmin', true)]);
    const badges = el.querySelectorAll('.source-badge');
    expect(badges).toHaveLength(2); expect(el.querySelectorAll('svg')).toHaveLength(2);
    expect(badges[0].getAttribute('aria-label')).toContain('Strava'); expect(badges[0].getAttribute('title')).toContain('Summary only');
    expect(badges[0].getAttribute('data-coverage')).toBe('summary'); expect(badges[0].textContent).toBe('S');
    expect(badges[1].getAttribute('aria-label')).toContain('Garmin'); expect(badges[1].getAttribute('title')).toContain('Detail retained');
    expect(badges[1].getAttribute('data-coverage')).toBe('detail'); expect(badges[1].textContent).toContain('✓');
    expect(el.textContent).not.toContain('Ready');
  });
  it('does not infer detail from normalization status, hides absent providers and marks failures', () => {
    const el = render([status('strava', null), { ...status('garmin', true), linked: false }]);
    expect(el.querySelectorAll('.source-badge')).toHaveLength(1);
    expect(el.querySelector('.marker')?.textContent).toBe('?'); expect(el.querySelector('.source-badge')?.getAttribute('title')).toContain('Detail not checked');
    TestBed.resetTestingModule();
    const failed = render([{ ...status('garmin', true), state: 'failed' }]);
    expect(failed.querySelector('.attention .marker')?.textContent).toBe('!'); expect(failed.querySelector('.source-badge')?.getAttribute('title')).toContain('processing failed');
  });
  it('keeps expanded provider diagnostics on the activity detail page', () => {
    const el = render([status('strava', true)], true);
    expect(el.textContent).toContain('Strava'); expect(el.textContent).toContain('10 metrics');
    expect(el.querySelector('.source-badge')).toBeNull();
  });
});
