import {afterEach, expect, it, vi} from 'vitest';
import {afterWorkerMutation, notifyWorker, validateWorkerWakeEnvironment, garminExecutionEnabled} from './worker-wake.js';
import {parseWakeKeys, verifyWake, WAKE_HEADER} from '@sportos/worker-wake';
import {ProvidersRepository} from '@sportos/db';
import {ProvidersService} from '../providers/providers.service.js';
const env={SPORTOS_WORKER_WAKE_URL:'https://wake.example.test/wake',SPORTOS_WORKER_WAKE_KEYS:`one=${btoa('a'.repeat(32))}`,SPORTOS_WORKER_WAKE_ACTIVE_KEY_ID:'one'};
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});

it('notifies only after commit and account release; rollback/missing result never wakes',async()=>{
  const events:string[]=[];
  const operation=(async()=>{await Promise.resolve();events.push('commit');await Promise.resolve();events.push('release');return {id:'persisted'};})();
  const notify=vi.fn(async()=>{events.push('wake');});
  expect(await afterWorkerMutation(operation,notify)).toEqual({id:'persisted'});
  expect(events).toEqual(['commit','release','wake']);
  await expect(afterWorkerMutation(Promise.reject(new Error('rollback')),notify)).rejects.toThrow('rollback');
  expect(await afterWorkerMutation(Promise.resolve(null),notify)).toBeNull();
  expect(notify).toHaveBeenCalledOnce();
});

it('preserves a committed result when notification fails and redacts the failure',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>undefined);
  expect(await afterWorkerMutation(Promise.resolve({id:'committed'}),async()=>{throw new Error('private token');})).toEqual({id:'committed'});
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
});

it('signs a fixed bounded request and never forwards owner/job/session payloads or follows redirects',async()=>{
  const fetcher=vi.fn(async(url:URL|RequestInfo, init?:RequestInit)=>{
    expect(String(url)).toBe(env.SPORTOS_WORKER_WAKE_URL);expect(init?.body).toBe('{}');expect(init?.redirect).toBe('manual');
    const header=new Headers(init?.headers).get(WAKE_HEADER);
    expect(await verifyWake(header,await parseWakeKeys(env.SPORTOS_WORKER_WAKE_KEYS))).toBeTruthy();
    return new Response(null,{status:202});
  });
  await notifyWorker(env,fetcher as typeof fetch);
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(notifyWorker(env,vi.fn(async()=>new Response(null,{status:302})))).rejects.toThrow();
});

it('bounds a stalled notification to three seconds and permits safe legacy configuration',async()=>{
  vi.useFakeTimers();
  const fetcher=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('timeout')),{once:true});}));
  const running=notifyWorker(env,fetcher as typeof fetch), assertion=expect(running).rejects.toThrow('timeout');
  // Crypto completes outside fake timers; wait for the fetch to begin.
  await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(3000);await assertion;expect(vi.getTimerCount()).toBe(0);
  await notifyWorker({},fetcher as typeof fetch);expect(fetcher).toHaveBeenCalledOnce();
});

it('validates deployment capability independently of heartbeat/transport health',async()=>{
  expect(garminExecutionEnabled({})).toBeUndefined();
  expect(garminExecutionEnabled({SPORTOS_GARMIN_EXECUTION_ENABLED:'true'})).toBe(true);
  expect(garminExecutionEnabled({SPORTOS_GARMIN_EXECUTION_ENABLED:'false'})).toBe(false);
  expect(()=>garminExecutionEnabled({SPORTOS_GARMIN_EXECUTION_ENABLED:'typo'})).toThrow();
  await validateWorkerWakeEnvironment({});await validateWorkerWakeEnvironment(env);
  await expect(validateWorkerWakeEnvironment({...env,SPORTOS_WORKER_WAKE_ACTIVE_KEY_ID:'unknown'})).rejects.toThrow();
  await expect(validateWorkerWakeEnvironment({...env,SPORTOS_WORKER_WAKE_URL:'http://bad/wake'})).rejects.toThrow();
});

it('notifies provider disconnect only after its mutation and account context have finished',async()=>{
  for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
  const events:string[]=[];
  const fetcher=vi.fn(async()=>{events.push('wake');return new Response(null,{status:202});});vi.stubGlobal('fetch',fetcher);
  vi.spyOn(ProvidersRepository.prototype,'loadWorkerAuthorization').mockResolvedValue(null);
  vi.spyOn(ProvidersRepository.prototype,'getConnection').mockResolvedValue({id:'connection'} as never);
  vi.spyOn(ProvidersRepository.prototype,'disconnect').mockImplementation(async()=>{events.push('disconnect');return true;});
  const service=new ProvidersService({withAccount:async(_owner:string,fn:(db:never)=>Promise<unknown>)=>{const result=await fn({} as never);events.push('release');return result;}} as never);
  expect(await service.disconnect('owner','connection')).toEqual({disconnected:true});
  expect(fetcher).toHaveBeenCalledOnce();expect(events.slice(-3)).toEqual(['disconnect','release','wake']);
});
