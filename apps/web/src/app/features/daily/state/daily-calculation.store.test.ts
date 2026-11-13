import {afterEach,describe,expect,it,vi} from 'vitest';
import {of,Subject,throwError} from 'rxjs';
import {DailyCalculationStore} from './daily-calculation.store';
import type {DailyCalculationJob} from '../model/daily-calculation.models';
const queued:DailyCalculationJob={id:'job',from:'2026-11-04',to:'2026-11-13',nextDate:'2026-11-04',processedDays:0,totalDays:10,status:'queued',errorCode:null,attemptCount:0};
const done={...queued,status:'succeeded' as const,nextDate:'2026-11-14',processedDays:10};
const state={cursor:{startDate:'2026-11-04',completedThrough:'2026-11-12',timeZone:'Europe/Copenhagen'},nextDate:'2026-11-13',activeJob:null,latestJob:null};
function setup(){const api={state:vi.fn().mockReturnValue(of(state)),start:vi.fn().mockReturnValue(of(queued)),job:vi.fn().mockReturnValue(of(done)),retry:vi.fn().mockReturnValue(of(queued)),cancel:vi.fn().mockReturnValue(of({...queued,status:'cancelled'}))};return {api,store:new DailyCalculationStore(api as never)}}
afterEach(()=>vi.useRealTimers());
describe('Calculate all workflow',()=>{
 it('reads on navigation, prevents concurrent submission, refreshes scores and permits ten separate completed runs today',async()=>{
  vi.useFakeTimers();const {api,store}=setup(),finished=vi.fn();store.initialize(finished);expect(api.start).not.toHaveBeenCalled();
  for(let i=0;i<10;i++){store.start();store.start();expect(api.start).toHaveBeenCalledTimes(i+1);await vi.runAllTimersAsync();expect(store.job()?.status).toBe('succeeded');expect(store.state()?.cursor.completedThrough).toBe('2026-11-12')}
  expect(finished).toHaveBeenCalledTimes(10);store.ngOnDestroy();
 });
 it('recovers active work after reopening without a new POST',async()=>{
  vi.useFakeTimers();const {api,store}=setup();api.state.mockReturnValue(of({...state,activeJob:queued}));store.initialize();await vi.runAllTimersAsync();expect(api.start).not.toHaveBeenCalled();expect(api.job).toHaveBeenCalledWith('job');store.ngOnDestroy();
 });
 it('requires a successful state read after an ambiguous mutation or failed status read',()=>{
  const {api,store}=setup();api.state.mockReturnValueOnce(throwError(()=>new Error('offline')));store.initialize();store.start();expect(api.start).not.toHaveBeenCalled();
  api.start.mockReturnValue(throwError(()=>new Error('timeout')));store.start();store.start();expect(api.start).toHaveBeenCalledOnce();expect(api.state).toHaveBeenCalledTimes(3);store.ngOnDestroy();
 });
 it('preserves failed-day details, supports retry/cancel and refreshes partial score results',async()=>{
  vi.useFakeTimers();const {api,store}=setup(),finished=vi.fn();api.job.mockReturnValue(of({...queued,status:'failed',processedDays:2,nextDate:'2026-11-06',errorCode:'DAILY_DATA_UNAVAILABLE'}));store.initialize(finished);store.start();await vi.runAllTimersAsync();expect(store.message()).toContain('2026-11-06');expect(finished).toHaveBeenCalledOnce();
  store.retry();expect(api.retry).toHaveBeenCalledWith('job');store.cancel();expect(api.cancel).toHaveBeenCalledWith('job');store.ngOnDestroy();
 });
 it('cancels transport on teardown and discards a previous completion read when another run begins',()=>{
  const {api,store}=setup();store.initialize();const late=new Subject<never>();api.start.mockReturnValue(of(done));api.state.mockReturnValue(late);store.start();
  api.state.mockReturnValue(of(state));store.start();expect(late.observed).toBe(false);api.start.mockReturnValue(of(queued));store.start();expect(store.job()?.status).toBe('queued');store.ngOnDestroy();late.next(state as never);expect(store.state()).toEqual(state);
 });
 it('pauses after bounded polling and resumes manually without starting new work',async()=>{
  vi.useFakeTimers();const {api,store}=setup();api.job.mockReturnValue(of(queued));store.initialize();store.start();await vi.advanceTimersByTimeAsync(610000);expect(api.job.mock.calls.length).toBeLessThanOrEqual(200);expect(store.error()).toContain('Automatic checks paused');
  api.job.mockReturnValue(of(done));store.check();await vi.runAllTimersAsync();expect(store.job()?.status).toBe('succeeded');expect(api.start).toHaveBeenCalledOnce();store.ngOnDestroy();
 });
});
