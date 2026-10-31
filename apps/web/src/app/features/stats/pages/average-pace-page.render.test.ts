// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { Directive } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Router, provideRouter } from '@angular/router';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Subject, of } from 'rxjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ColorSchemeService } from '../../../core/theme/color-scheme.service';
import { PaceSpeedApiService } from '../data-access/pace-speed-api.service';
import type { PaceSpeedResponse } from '../model/pace-speed.models';
import { AveragePacePageComponent } from './average-pace-page.component';

@Directive({ selector: '[echarts]', standalone: true, inputs: ['theme', 'options'] })
class ChartStub {
  theme: unknown;
  options: unknown;
}

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());

async function setup() {
  const pending = new Subject<PaceSpeedResponse>();
  const api = { trends: vi.fn().mockReturnValue(pending) };
  TestBed.configureTestingModule({
    imports: [AveragePacePageComponent],
    providers: [provideRouter([]), { provide: PaceSpeedApiService, useValue: api },
      { provide: ColorSchemeService, useValue: { chartTheme: () => undefined } }],
  });
  TestBed.overrideComponent(AveragePacePageComponent, {
    remove: { imports: [NgxEchartsDirective] }, add: { imports: [ChartStub] },
  });
  await TestBed.inject(Router).navigate([], { queryParams: { from: '2026-01-01', to: '2026-01-31', filter: '1', threshold: '360' } });
  const fixture = TestBed.createComponent(AveragePacePageComponent);
  fixture.detectChanges();
  return { api, pending, fixture, el: fixture.nativeElement as HTMLElement };
}

describe('pace and speed report rendering', () => {
  it('renders loaded periods and preserves their labels and activity links while dates/grain are edited', async () => {
    const { pending, fixture, el } = await setup();
    expect(el.querySelector('[role=status]')?.textContent).toContain('Loading');
    pending.next({ source: 'strava', range: { from: '2026-01-01', to: '2026-01-31' }, sport: 'run', granularity: 'weekly', threshold: 360,
      buckets: [{ key: '2025-12-29', totalDistanceM: 15000, includedDistanceM: 12000, includedTimeS: 3600, missingTimeDistanceM: 1000, activities: 3, includedActivities: 2, value: 300 }] });
    fixture.detectChanges();
    expect(el.querySelector('tbody')?.textContent).toContain('5:00 /km');
    const from = el.querySelector<HTMLInputElement>('input[type=date]')!;
    from.value = '2026-01-20';
    from.dispatchEvent(new Event('input'));
    const grain = el.querySelectorAll('select')[2]!;
    grain.value = 'monthly';
    grain.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('#pace-table-title')?.textContent).toBe('Weekly activity ledger');
    expect(el.querySelector('.chart-card .section-title')?.textContent).toContain('2026-01-01 → 2026-01-31');
    const link = el.querySelector<HTMLAnchorElement>('tbody a')!;
    expect(link.getAttribute('href')).toContain('from=2026-01-01');
    expect(link.getAttribute('href')).toContain('to=2026-01-04');
    expect(link.getAttribute('href')).toContain('source=strava');
  });

  it('renders a safe error and lets Retry recover to an empty result', async () => {
    const { api, pending, fixture, el } = await setup();
    pending.error(new Error('Private database error'));
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Could not load');
    expect(el.textContent).not.toContain('Private database error');
    api.trends.mockReturnValue(of({ source: 'strava', range: { from: '2026-01-01', to: '2026-01-31' }, sport: 'run', granularity: 'weekly', threshold: 360, buckets: [] }));
    el.querySelector<HTMLButtonElement>('[role=alert] button')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('No runs in this range');
    expect(el.querySelector('table')).toBeNull();
  });
});
