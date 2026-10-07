import '@angular/compiler';
import { EnvironmentInjector, Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { GarminDayCardComponent } from './garmin-day-card.component';
import { GarminDayStore } from '../state/garmin-day.store';
function setup(){const store={load:vi.fn()};const injector=createEnvironmentInjector([{provide:GarminDayStore,useValue:store}],Injector.NULL as unknown as EnvironmentInjector);return {injector,store,component:runInInjectionContext(injector,()=>new GarminDayCardComponent())};}
describe('Garmin day evidence card',()=>{
  it('labels missing, unsupported, private, authentication and rate-limited states distinctly',()=>{
    const {component,injector}=setup();expect(component.status('not_recorded')).toContain('Not recorded');expect(component.status('unsupported')).toContain('Unsupported');expect(component.status('private')).toContain('Private');expect(component.status('authentication_required')).toContain('Authentication required');expect(component.status('rate_limited')).toContain('Rate limited');injector.destroy();
  });
  it('shows retained metric units and missing values without replacing a real zero',()=>{
    const {component,injector}=setup();expect(component.metricRows({steps:0,distanceM:2500,totalCalories:null})).toEqual([{key:'steps',label:'All-day steps',value:'0'},{key:'distanceM',label:'Distance',value:'2500 m'},{key:'totalCalories',label:'Total calories',value:'Not recorded'}]);injector.destroy();
  });
  it('replaces the card workflow when the selected calendar date changes',()=>{
    const {component,store,injector}=setup();Object.defineProperty(component,'date',{value:()=> '2026-03-29',configurable:true});component.ngOnChanges();expect(store.load).toHaveBeenCalledWith('2026-03-29');Object.defineProperty(component,'date',{value:()=> '2026-03-30'});component.ngOnChanges();expect(store.load).toHaveBeenCalledWith('2026-03-30');injector.destroy();
  });
});
