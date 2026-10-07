import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { GarminDayStore } from './garmin-day.store';
const day={date:'2026-03-29',origin:'garmin_connect',evidenceOnly:true,fetchEnabled:true,state:'current',categories:[]};
function setup(){const api={read:vi.fn(()=>of(day)),fetch:vi.fn(()=>of({...day,result:'cached'})),resource:vi.fn(()=>of({payload:{totalSteps:12}}))};return {api,store:new GarminDayStore(api as never)};}
describe('Garmin day state',()=>{
  it('navigation reads coverage only and viewing reads no upstream data',()=>{
    const {api,store}=setup();store.load(day.date);expect(api.read).toHaveBeenCalledWith(day.date);expect(api.fetch).not.toHaveBeenCalled();expect(api.resource).not.toHaveBeenCalled();store.view();expect(store.expanded()).toBe(true);expect(api.fetch).not.toHaveBeenCalled();
  });
  it('explicit fetch/refresh never asks for recalculation and resources are explicit',()=>{
    const {api,store}=setup();store.load(day.date);store.fetch();expect(api.fetch).toHaveBeenCalledWith(day.date,false);store.fetch(true);expect(api.fetch).toHaveBeenCalledWith(day.date,true);expect(store.expanded()).toBe(true);expect(api.resource).not.toHaveBeenCalled();store.resource('weight');expect(api.resource).toHaveBeenCalledWith(day.date,'weight');
  });
  it('prevents repeated clicks and cancels stale responses on date replacement and teardown',()=>{
    const {api,store}=setup();const pending=new Subject<never>();api.fetch.mockReturnValue(pending as never);store.load(day.date);store.fetch();store.fetch();expect(api.fetch).toHaveBeenCalledTimes(1);store.load('2026-03-30');pending.next(day as never);expect(store.fetching()).toBe(false);expect(pending.observed).toBe(false);store.fetch();store.ngOnDestroy();expect(pending.observed).toBe(false);
  });
  it('preserves prior evidence on auth/rate-limit failure and allows retry',()=>{
    const {api,store}=setup();api.fetch.mockReturnValue(throwError(()=>new HttpErrorResponse({status:503,error:{message:'Garmin rate limited the request. Retry later.'}})));store.load(day.date);store.fetch(true);expect(store.error()).toContain('rate limited');expect(store.data()).toEqual(day);expect(store.fetching()).toBe(false);store.fetch();expect(api.fetch).toHaveBeenCalledTimes(2);
  });
  it('disables downloads when policy forbids them while permitting retained reads',()=>{
    const {api,store}=setup();api.read.mockReturnValue(of({...day,fetchEnabled:false}));store.load(day.date);store.fetch();expect(api.fetch).not.toHaveBeenCalled();store.view();expect(store.expanded()).toBe(true);
  });
});
