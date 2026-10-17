import '@angular/compiler';
import {Injector} from '@angular/core';
import {Subject,of,throwError} from 'rxjs';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {PerformanceApiService} from '../data-access/performance-api.service';
import type {DistanceLeaderboard} from '../model/performance.models';
import {DistanceLeaderboardStore} from './distance-leaderboard.store';
const result={rows:[],targets:[5000],targetDistanceM:5000,coverage:{eligibleRuns:2,measuredCurrent:0,legacyLinked:0,legacyUnmatched:0,legacyAmbiguous:0,estimatedOnly:2,missingRichDetail:2,unprocessed:0,staleOrFailed:0,unavailable:0}} satisfies DistanceLeaderboard;
describe('distance leaderboard workflow',()=>{

 function setup(leaderboard=vi.fn().mockReturnValue(of(result))){const injector=Injector.create({providers:[DistanceLeaderboardStore,{provide:PerformanceApiService,useValue:{leaderboard}}]});return {store:injector.get(DistanceLeaderboardStore),leaderboard};}
 it('loads current qualified evidence with explicit empty coverage',()=>{const {store,leaderboard}=setup();store.load();expect(store.result()).toEqual(result);expect(store.loading()).toBe(false);expect(leaderboard).toHaveBeenCalledWith({distanceM:5000,from:undefined,to:undefined,limit:200});});
 it('cancels replaced requests and teardown prevents stale responses',()=>{const a=new Subject<DistanceLeaderboard>(),b=new Subject<DistanceLeaderboard>();const {store}=setup(vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b));store.load();store.distanceM.set(10000);store.load();a.next(result);expect(store.result()).toBeNull();expect(a.observed).toBe(false);store.ngOnDestroy();expect(b.observed).toBe(false);});
 it('clears old ranks after errors and allows retry',()=>{const {store}=setup(vi.fn().mockReturnValueOnce(of(result)).mockReturnValueOnce(throwError(()=>new Error('unavailable'))).mockReturnValueOnce(of(result)));store.load();store.load();expect(store.result()).toBeNull();expect(store.error()).toContain('could not');store.load();expect(store.error()).toBeNull();expect(store.result()).toEqual(result);});
 it('validates calendar dates without UTC conversions before calling API',()=>{const {store,leaderboard}=setup();store.from.set('2026-02-30');store.load();expect(store.error()).toContain('valid date');store.from.set('2026-05-01');store.to.set('2026-04-30');store.load();expect(leaderboard).not.toHaveBeenCalled();});
});
