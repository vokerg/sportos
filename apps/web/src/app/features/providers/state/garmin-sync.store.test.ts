import {afterEach,describe,expect,it,vi} from 'vitest';
import {of,Subject,throwError} from 'rxjs';
import {GarminSyncStore} from './garmin-sync.store';
import type {GarminFetchJob} from '../../../shared/model/garmin-job';
const queued:GarminFetchJob={id:'job',operation:'sync',date:null,activityId:null,refresh:true,status:'queued',phase:'queued',attemptCount:0,errorCode:null,from:'2026-11-07',to:'2026-11-09',nextDate:'2026-11-07',processedDays:0,totalDays:3};
const done={...queued,status:'succeeded' as const,processedDays:3,nextDate:'2026-11-10'};
function setup(){const api={connection:vi.fn().mockReturnValue(of({enabled:true,reason:'ready',cursor:{date:'2026-11-07',at:'2026-11-07T00:00:00Z',completed:false},activeJob:null})),sync:vi.fn().mockReturnValue(of(queued)),job:vi.fn().mockReturnValue(of(done)),cancel:vi.fn().mockReturnValue(of({...queued,status:'cancelled'})),retry:vi.fn().mockReturnValue(of(queued))};return {api,store:new GarminSyncStore(api as never)}}
afterEach(()=>vi.useRealTimers());
describe('general Garmin sync',()=>{
 it('submits an empty server-derived sync once, shows progress, reloads cursor and permits another same-day run',async()=>{
  vi.useFakeTimers();const {api,store}=setup();const finished=vi.fn();store.initialize(finished);
  store.sync();store.sync();expect(api.sync).toHaveBeenCalledTimes(1);
  await vi.runAllTimersAsync();expect(store.job()?.status).toBe('succeeded');expect(finished).toHaveBeenCalledOnce();
  expect(api.connection).toHaveBeenCalledTimes(2);store.sync();expect(api.sync).toHaveBeenCalledTimes(2);store.ngOnDestroy();
 });
 it('recovers active server work after reopening without enqueueing or relying on a browser cursor',async()=>{
  vi.useFakeTimers();const {api,store}=setup();api.connection.mockReturnValue(of({enabled:true,activeJob:queued,cursor:null}));store.initialize();
  expect(api.sync).not.toHaveBeenCalled();expect(store.job()?.id).toBe('job');await vi.runAllTimersAsync();expect(api.job).toHaveBeenCalledWith('job');store.ngOnDestroy();
 });
 it('recovers an ambiguous POST by checking status before allowing a second submission',()=>{
  const {api,store}=setup();api.sync.mockReturnValue(throwError(()=>new Error('timeout')));store.initialize();store.sync();expect(api.sync).toHaveBeenCalledOnce();store.sync();expect(api.sync).toHaveBeenCalledOnce();expect(api.connection).toHaveBeenCalledTimes(2);store.ngOnDestroy();
 });
 it('cancels polling and discards late responses when the route is destroyed',()=>{
  const {api,store}=setup();const response=new Subject<GarminFetchJob>();api.sync.mockReturnValue(response);store.initialize();store.sync();store.ngOnDestroy();response.next(done);expect(store.job()).toBeNull();
 });
 it('keeps failed and cancelled work retryable and never sends recalculation',async()=>{
  vi.useFakeTimers();const {api,store}=setup();api.job.mockReturnValue(of({...queued,status:'failed',errorCode:'GARMIN_PARTIAL_FAILURE'}));store.initialize();store.sync();await vi.runAllTimersAsync();expect(store.job()?.status).toBe('failed');store.retry();expect(api.retry).toHaveBeenCalledWith('job');store.ngOnDestroy();
 });
 it('discards a previous completion cursor read when a new sync starts',()=>{
  const {api,store}=setup();const late=new Subject<never>();store.initialize();api.sync.mockReturnValue(of(done));api.connection.mockReturnValue(late);store.sync();
  api.sync.mockReturnValue(of(queued));store.sync();expect(late.observed).toBe(false);expect(store.job()?.status).toBe('queued');store.ngOnDestroy();
 });

});
