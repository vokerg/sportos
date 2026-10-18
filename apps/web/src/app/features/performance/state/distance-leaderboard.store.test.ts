import '@angular/compiler';
import {Injector} from '@angular/core';
import {Subject,of,throwError} from 'rxjs';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {PerformanceApiService} from '../data-access/performance-api.service';
import type {DistanceLeaderboard} from '../model/performance.models';
import {DistanceLeaderboardStore} from './distance-leaderboard.store';
const result={rows:[],targets:[5000],targetDistanceM:5000,total:0,limit:100,offset:0,coverage:{eligibleRuns:2,measuredCurrent:0,legacyLinked:0,legacyUnmatched:0,legacyAmbiguous:0,estimatedOnly:2,missingRichDetail:2,unprocessed:0,staleOrFailed:0,unavailable:0}} satisfies DistanceLeaderboard;
describe('distance leaderboard workflow',()=>{

 function setup(leaderboard=vi.fn().mockReturnValue(of(result))){const injector=Injector.create({providers:[DistanceLeaderboardStore,{provide:PerformanceApiService,useValue:{leaderboard}}]});return {store:injector.get(DistanceLeaderboardStore),leaderboard};}
 it('loads current qualified evidence with explicit empty coverage',()=>{const {store,leaderboard}=setup();store.load();expect(store.result()).toEqual(result);expect(store.loading()).toBe(false);expect(leaderboard).toHaveBeenCalledWith({distanceM:5000,from:undefined,to:undefined,limit:100,offset:0});});
 it('cancels replaced requests and teardown prevents stale responses',()=>{const a=new Subject<DistanceLeaderboard>(),b=new Subject<DistanceLeaderboard>();const {store}=setup(vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b));store.load();store.distanceM.set(10000);store.load();a.next(result);expect(store.result()).toBeNull();expect(a.observed).toBe(false);store.ngOnDestroy();expect(b.observed).toBe(false);});
 it('clears old ranks after errors and allows retry',()=>{const {store}=setup(vi.fn().mockReturnValueOnce(of(result)).mockReturnValueOnce(throwError(()=>new Error('unavailable'))).mockReturnValueOnce(of(result)));store.load();store.load();expect(store.result()).toBeNull();expect(store.error()).toContain('could not');store.load();expect(store.error()).toBeNull();expect(store.result()).toEqual(result);});
 it('pages beyond 200 with applied filters and resets on filter or page-size changes',()=>{
  const leaderboard=vi.fn().mockImplementation(q=>of({...result,total:1050,offset:q.offset,limit:q.limit}));const {store}=setup(leaderboard);
  store.load();store.goTo(200);expect(leaderboard).toHaveBeenLastCalledWith({distanceM:5000,from:undefined,to:undefined,limit:100,offset:200});
  store.distanceM.set(10000);store.goTo(300);expect(leaderboard.mock.lastCall?.[0].distanceM).toBe(5000);
  store.load();expect(leaderboard.mock.lastCall?.[0]).toMatchObject({distanceM:10000,offset:0});
  store.goTo(200);store.setPageSize(50);expect(leaderboard.mock.lastCall?.[0]).toMatchObject({limit:50,offset:0});store.goTo(9999);expect(store.offset()).toBe(1000);
 });
 it('retries the failed page rather than resetting to the top',()=>{
  const leaderboard=vi.fn().mockReturnValueOnce(of({...result,total:350})).mockReturnValueOnce(throwError(()=>new Error('failed'))).mockReturnValueOnce(of({...result,total:350,offset:200}));
  const {store}=setup(leaderboard);store.load();store.goTo(200);expect(store.error()).not.toBeNull();store.retry();expect(leaderboard.mock.lastCall?.[0].offset).toBe(200);expect(store.result()?.offset).toBe(200);
 });
 it('clamps a stale last page once when qualified records shrink',()=>{
  const leaderboard=vi.fn().mockReturnValueOnce(of({...result,total:450})).mockReturnValueOnce(of({...result,total:120,offset:400})).mockReturnValueOnce(of({...result,total:120,offset:100}));
  const {store}=setup(leaderboard);store.load();store.goTo(400);expect(leaderboard).toHaveBeenCalledTimes(3);expect(store.offset()).toBe(100);
 });
 it('validates calendar dates without UTC conversions before calling API',()=>{const {store,leaderboard}=setup();store.from.set('2026-02-30');store.load();expect(store.error()).toContain('valid date');store.from.set('2026-05-01');store.to.set('2026-04-30');store.load();expect(leaderboard).not.toHaveBeenCalled();});
});
