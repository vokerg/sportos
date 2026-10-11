// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ActivityMetricComparisonComponent } from './activity-metric-comparison.component';
import { ActivityMetricProvenanceComponent } from './activity-metric-provenance.component';
import type { ActivityMetricComparison } from '../model/activity-metrics.models';

const distance: ActivityMetricComparison = {key:'distance',label:'Distance',unit:'m',selected:{value:10000,source:'strava',reason:'canonical_authority'},candidates:[
  {provider:'garmin',value:10005,sourceKind:'fit_session',sourceField:'total_distance',sourceUnit:'m',origin:'recorded',selectedWithinProvider:true,projectionId:'test-version',projectedAt:'2026-01-01'},
  {provider:'strava',value:10000,sourceKind:'compact',sourceField:'distance',sourceUnit:'m',origin:'provider_derived',selectedWithinProvider:true,projectionId:'test-version',projectedAt:'2026-01-01'},
]};
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
function render(metrics: ActivityMetricComparison[], sport = 'run') {
  const fixture = TestBed.createComponent(ActivityMetricComparisonComponent);
  // Vitest's TS transform does not compile signal-input metadata. Feed the same
  // input signals directly; production input bindings are checked by ng build.
  Object.defineProperty(fixture.componentInstance, 'metrics', { value: signal(metrics) });
  Object.defineProperty(fixture.componentInstance, 'sport', { value: signal(sport) });
  fixture.detectChanges(); return fixture.nativeElement as HTMLElement;
}
describe('activity metrics rendered UI', () => {
  it('renders equal sources once, grouped, without Selected or provenance disclosures', () => {
    const el = render([distance]);
    expect(el.querySelectorAll('.value')).toHaveLength(1);
    expect(el.textContent).toContain('10 km'); expect(el.textContent).toContain('Strava · Garmin');
    expect(el.textContent).toContain('Time & Distance'); expect(el.textContent).not.toContain('Authoritative'); expect(el.querySelector('.authoritative')).toBeNull();
    expect(el.textContent).not.toContain('Selected'); expect(el.querySelector('details')).toBeNull();
    expect(el.textContent).not.toContain('test-version');
  });
  it('renders distinct sources Strava first and emphasizes only the primary value', () => {
    const el = render([{...distance,selected:{value:11000,source:'garmin',reason:'provider_priority'},candidates:distance.candidates.map(c => c.provider === 'garmin' ? {...c,value:11000} : c)}]);
    const rows = [...el.querySelectorAll('.value')];
    expect(rows).toHaveLength(2); expect(rows[0].textContent).toContain('Strava');
    expect(rows[0].textContent).not.toContain('Authoritative'); expect(rows[1].textContent).toContain('Garmin');
    expect(rows[1].textContent).not.toContain('Authoritative');
    expect(rows[0].classList.contains('authoritative')).toBe(false);
    expect(rows[1].classList.contains('authoritative')).toBe(true);
  });
  it('shows Garmin fallback without claiming authority and renders missing observations', () => {
    const el = render([{...distance,selected:null,candidates:[distance.candidates[0]]}, {key:'average_heart_rate',label:'Average heart rate',unit:'bpm',selected:null,candidates:[]}]);
    expect(el.textContent).toContain('Read-only fallback'); expect(el.textContent).not.toContain('Authoritative');
    expect(el.textContent).toContain('Heart Rate'); expect(el.textContent).toContain('Unavailable');
  });
  it('renders normalized running cadence with both sources and reacts to inputs', () => {
    const fixture = TestBed.createComponent(ActivityMetricComparisonComponent);
    const metrics = signal([{...distance,key:'average_cadence',label:'Average cadence',unit:'rpm',selected:{value:88,source:'strava',reason:'provider_priority' as const},candidates:distance.candidates.map(c => ({...c,value:88}))}]);
    const sport = signal('run');
    Object.defineProperty(fixture.componentInstance,'metrics',{value:metrics});
    Object.defineProperty(fixture.componentInstance,'sport',{value:sport});
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('176 steps/min');
    expect(fixture.nativeElement.textContent).toContain('Running Dynamics');
    sport.set('bike'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('88 rpm');
    expect(fixture.nativeElement.textContent).not.toContain('176 steps/min');
  });
  it('renders sport-specific swimming units and empty state', () => {
    const el = render([{key:'average_pace',label:'Average pace',unit:'s/km',selected:{value:1200,source:'strava',reason:'canonical_authority'},candidates:[]}], 'swim');
    expect(el.textContent).toContain('2:00 /100m');
    TestBed.resetTestingModule(); expect(render([]).querySelector('section')).toBeNull();
  });
  it('preserves all competing observations in the separate advanced provenance component', () => {
    const fixture = TestBed.createComponent(ActivityMetricProvenanceComponent);
    Object.defineProperty(fixture.componentInstance, 'metrics', {value:signal([{...distance,candidates:[...distance.candidates,{...distance.candidates[0],value:9999,sourceField:'legacy_distance',selectedWithinProvider:false}]}])});
    fixture.detectChanges(); const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('summary')?.textContent).toContain('Normalized metric provenance');
    expect(el.textContent).toContain('total_distance'); expect(el.textContent).toContain('legacy_distance');
    expect(el.textContent).toContain('alternative'); expect(el.textContent).toContain('test-version');
  });
});
