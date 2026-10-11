// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { EnvironmentInjector, Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GarminDayCardComponent } from './garmin-day-card.component';
import { GarminDayStore } from '../state/garmin-day.store';
beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
afterEach(() => TestBed.resetTestingModule());
function setup() {
  const store = {load: vi.fn(), data: () => null};
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
  it('replaces the card workflow when the selected calendar date changes',()=>{
    const {component,store,injector}=setup();Object.defineProperty(component,'date',{value:()=> '2026-03-29',configurable:true});component.ngOnChanges();expect(store.load).toHaveBeenCalledWith('2026-03-29');Object.defineProperty(component,'date',{value:()=> '2026-03-30'});component.ngOnChanges();expect(store.load).toHaveBeenCalledWith('2026-03-30');injector.destroy();
  });
});
