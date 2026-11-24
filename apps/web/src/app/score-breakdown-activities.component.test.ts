// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ScoreBreakdownActivitiesComponent } from './score-breakdown-activities.component';
import type { DailyScoreBreakdown, ScoreBreakdownActivity } from './score-breakdown.models';

beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
it('links day activities in start-time order with untimed records last', () => {
  TestBed.configureTestingModule({providers:[provideRouter([])]});
  const fixture = TestBed.createComponent(ScoreBreakdownActivitiesComponent);
  const activity = {id:'canonical-run',source:'strava',sourceActivityId:'provider-native-id',activityDate:'2026-10-11',startTime:null,activityType:'run',subtype:null,distanceM:5000,durationS:1500,movingTimeS:1500,steps:null,calories:null,avgHr:null,maxHr:null,elevationGainM:null,avgSpeedMps:null,avgPaceSPerKm:300,effortPoints:null,notes:null,sourceRecord:null} satisfies ScoreBreakdownActivity;
  const breakdown = {date:'2026-10-11',activities:[
    { ...activity, id: 'canonical-untimed' },
    { ...activity, id: 'canonical-swim', activityType: 'swim', startTime: '2026-10-11T17:30:00.000Z', avgPaceSPerKm: 1225 },
    { ...activity, startTime: '2026-10-11T06:00:00.000Z' },
    { ...activity, id: 'canonical-manual', source: 'manual' },
  ],ledger:[]} as unknown as DailyScoreBreakdown;
  // Supply input signals directly for Vitest's JIT compilation.
  Object.defineProperty(fixture.componentInstance,'breakdown',{value:signal(breakdown)});
  Object.defineProperty(fixture.componentInstance,'garminActivityIds',{value:signal(['canonical-run'])});
  fixture.detectChanges();
  const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')];
  expect(links.map(a => a.getAttribute('href'))).toEqual(['/activity/canonical-run', '/activity/canonical-swim', '/activity/canonical-untimed']);
  expect((fixture.nativeElement as HTMLElement).textContent).toContain('2:03 /100 m');
  expect((fixture.nativeElement as HTMLElement).textContent).toContain('Garmin');
  expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Manual');
  expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Provenance');
  expect(links[0].textContent).toContain('run');
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router,'navigateByUrl').mockResolvedValue(true);
  links[0].dispatchEvent(new MouseEvent('click',{button:0,bubbles:true,cancelable:true}));
  expect(navigate).toHaveBeenCalledOnce();
  expect(router.serializeUrl(navigate.mock.calls[0][0] as never)).toBe('/activity/canonical-run');
});
