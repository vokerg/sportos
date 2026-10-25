// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { of, Subject } from 'rxjs';
import { SimpleChange } from '@angular/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GarminDayCardComponent } from './garmin-day-card.component';
import { GarminDayStore } from '../state/garmin-day.store';
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
function setup() {
  const store = {load: vi.fn(), data: () => null, fetching: () => false};
  TestBed.configureTestingModule({providers: [{provide: GarminDayStore, useValue: store}]});
  const component = TestBed.runInInjectionContext(() => new GarminDayCardComponent());
  return {component, store, injector: {destroy: () => TestBed.resetTestingModule()}};
}
describe('Garmin day evidence card',()=>{
  it('labels missing, unsupported, private, authentication and rate-limited states distinctly',()=>{
    const {component,injector}=setup();expect(component.status('not_recorded')).toContain('Not recorded');expect(component.status('unsupported')).toContain('Unsupported');expect(component.status('private')).toContain('Private');expect(component.status('authentication_required')).toContain('Authentication required');expect(component.status('rate_limited')).toContain('Rate limited');injector.destroy();
  });
  it('shows retained metric units and missing values without replacing a real zero',()=>{
    const {component,injector}=setup();expect(component.metricRows({steps:0,distanceM:2500,totalCalories:null})).toEqual([{key:'steps',label:'All-day steps',value:'0'},{key:'distanceM',label:'Distance',value:'2.5 km'}]);injector.destroy();
  });
  it('switches inspection views without reloading coverage or fetching resources', () => {
    const {component, store, injector} = setup();
    component.ngOnChanges({inspection: new SimpleChange(false, true, false)});
    expect(store.load).not.toHaveBeenCalled();
    injector.destroy();
  });
  it('rereads compact coverage after Strava completes without fetching provider data', () => {
    const {component, store, injector} = setup();
    Object.defineProperty(component, 'date', {value: () => '2026-03-29'});
    component.ngOnChanges({coverageRevision: new SimpleChange(0, 1, false)});
    expect(store.load).toHaveBeenCalledWith('2026-03-29');
    store.load.mockClear();
    store.fetching = () => true;
    component.ngOnChanges({coverageRevision: new SimpleChange(1, 2, false)});
    expect(store.load).not.toHaveBeenCalled();
    injector.destroy();
  });
  it('keeps real zero values and full missing states available in Sources', () => {
    const {component, injector} = setup();
    Object.defineProperty(component, 'inspection', {value: () => true});
    expect(component.metricRows({steps: 0, totalCalories: null})).toEqual([
      {key: 'steps', label: 'All-day steps', value: '0'},
      {key: 'totalCalories', label: 'Total calories', value: 'Not recorded'},
    ]);
    injector.destroy();
  });
  it('replaces the card workflow when the selected calendar date changes',()=>{
    const {component,store,injector}=setup();Object.defineProperty(component,'date',{value:()=> '2026-03-29',configurable:true});component.ngOnChanges();expect(store.load).toHaveBeenCalledWith('2026-03-29');Object.defineProperty(component,'date',{value:()=> '2026-03-30'});component.ngOnChanges();expect(store.load).toHaveBeenCalledWith('2026-03-30');injector.destroy();
  });
});

function renderDay(state: 'missing' | 'current' | 'partial', result?: 'cached' | 'fetched') {
  const day = {date: '2026-03-29', origin: 'garmin_connect', evidenceOnly: true,
    fetchEnabled: true, state, completeness: 'complete', result: result ?? null, categories: []};
  const api = {read: vi.fn(() => of(day)), fetch: vi.fn(() => of({...day, state: 'current', result: 'fetched'}))};
  const store = new GarminDayStore(api as never);
  TestBed.configureTestingModule({imports: [GarminDayCardComponent]});
  TestBed.overrideComponent(GarminDayCardComponent, {set: {providers: [{provide: GarminDayStore, useValue: store}]}});
  const fixture = TestBed.createComponent(GarminDayCardComponent);
  // Vitest JIT does not compile signal-input metadata; supply the input getter.
  Object.defineProperty(fixture.componentInstance, 'date', {value: () => day.date});
  store.load(day.date);
  fixture.detectChanges();
  return {fixture, api, store};
}

it.each(['missing', 'current', 'partial'] as const)('the main %s-day action requests fresh Garmin data', state => {
  const {fixture, api} = renderDay(state);
  const label = state === 'missing' ? 'Fetch Garmin day' : 'Refresh from Garmin';
  expect(api.fetch).not.toHaveBeenCalled();
  const button = [...fixture.nativeElement.querySelectorAll('button')].find(item => item.textContent?.trim() === label) as HTMLButtonElement;
  expect(button).toBeDefined();
  button.click();
  fixture.detectChanges();
  expect(api.fetch).toHaveBeenCalledExactlyOnceWith('2026-03-29', true);
  expect(fixture.nativeElement.textContent).toContain('Latest day data checked. Use Recalculate');
});

it('explains cached and incomplete results without claiming a successful update', () => {
  const {fixture, store} = renderDay('current', 'cached');
  expect(fixture.nativeElement.textContent).toContain('Saved data reused; use Refresh from Garmin');
  store.data.update(day => ({...day!, state: 'partial', result: 'fetched'}));
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Update attempted; some data is still unavailable');
  expect(fixture.nativeElement.textContent).not.toContain('Latest day data checked');
});

it('shows full current-day evidence as provisional and keeps refresh available after the day ends', () => {
  const { fixture, store, api } = renderDay('partial', 'fetched');
  store.data.update(day => ({ ...day!, completeness: 'in_progress' }));
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Incomplete — day in progress');
  expect(fixture.nativeElement.textContent).toContain('even when every category has data');
  expect(fixture.nativeElement.textContent).toContain('then use Recalculate');
  expect(fixture.nativeElement.textContent).not.toContain('Latest day data checked');
  store.data.update(day => ({ ...day!, completeness: 'refresh_required', result: null }));
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Incomplete — refresh required');
  expect(api.fetch).not.toHaveBeenCalled();
  const button = [...fixture.nativeElement.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Refresh from Garmin') as HTMLButtonElement;
  expect(button.disabled).toBe(false);
  button.click();
  expect(api.fetch).toHaveBeenCalledExactlyOnceWith('2026-03-29', true);
});

it('disables both refresh controls while an update is running', () => {
  const {fixture, api} = renderDay('current');
  const pending = new Subject<never>();
  api.fetch.mockReturnValue(pending as never);
  const primary = [...fixture.nativeElement.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Refresh from Garmin') as HTMLButtonElement;
  primary.click();
  fixture.detectChanges();
  const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
  expect(buttons.find(item => item.textContent?.includes('Updating Garmin day'))?.disabled).toBe(true);
  expect(buttons.find(item => item.textContent?.trim() === 'Refresh from Garmin')?.disabled).toBe(true);
  expect(fixture.nativeElement.textContent).toContain('This can take a few minutes');
  pending.complete();
  fixture.destroy();
});
