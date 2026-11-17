import {afterEach, expect, it, vi} from 'vitest';
import {WakeCoordinator, RECOVERY_INTERVAL_MS} from './wake-coordinator.js';
import {drainQueues} from './worker-pass.js';
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

it('scans at startup, then remains completely idle until explicit wake or hourly recovery', async () => {
  vi.useFakeTimers();
  const abort = new AbortController(), pass = vi.fn(async () => null);
  const coordinator = new WakeCoordinator(pass), running = coordinator.run(abort.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(pass).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS-1);
  expect(pass).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(pass).toHaveBeenCalledTimes(2);
  coordinator.wake(); coordinator.wake(); coordinator.wake();
  await vi.advanceTimersByTimeAsync(0);
  expect(pass).toHaveBeenCalledTimes(3);
  abort.abort(); await running;
  expect(vi.getTimerCount()).toBe(0);
});

it('rechecks persisted retry/lease deadlines without waiting an hour', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const pass = vi.fn<() => Promise<Date|null>>().mockResolvedValueOnce(new Date(Date.now()+15_000)).mockResolvedValue(null);
  const running = new WakeCoordinator(pass).run(abort.signal);
  await vi.advanceTimersByTimeAsync(14_999); expect(pass).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(pass).toHaveBeenCalledTimes(2);
  abort.abort(); await running;
});

it('preserves a wake arriving during processing and pool destruction, without overlapping passes', async () => {
  vi.useFakeTimers();
  let close!: () => void;
  const closing = new Promise<void>(resolve => {close = resolve;});
  const events: string[] = [], abort = new AbortController();
  const pass = vi.fn(async () => {events.push('pass'); if(events.length===1) {await closing; events.push('closed');} return null;});
  const coordinator = new WakeCoordinator(pass), running = coordinator.run(abort.signal);
  coordinator.wake();coordinator.wake();
  expect(pass).toHaveBeenCalledTimes(1);
  close();await vi.advanceTimersByTimeAsync(0);
  expect(events).toEqual(['pass','closed','pass']);
  abort.abort();await running;
});

it('backs persistent connection failures off to an hour and does not log private errors', async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console,'warn').mockImplementation(() => undefined), abort = new AbortController();
  const pass = vi.fn(async () => {throw Object.assign(new Error('private password'), {code:'ECONNRESET'});});
  const coordinator = new WakeCoordinator(pass), running = coordinator.run(abort.signal);
  await vi.advanceTimersByTimeAsync(0);
  for(let i=0;i<13;i++) await vi.advanceTimersByTimeAsync(Math.min(RECOVERY_INTERVAL_MS,1000*2**i));
  const count=pass.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);expect(pass).toHaveBeenCalledTimes(count);
  coordinator.wake();coordinator.wake();await vi.advanceTimersByTimeAsync(0);
  expect(pass).toHaveBeenCalledTimes(count+1);
  coordinator.wake();coordinator.wake();await vi.advanceTimersByTimeAsync(59_999);
  expect(pass).toHaveBeenCalledTimes(count+1);
  await vi.advanceTimersByTimeAsync(1);expect(pass).toHaveBeenCalledTimes(count+2);
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  abort.abort();await running;
});

it('surfaces programming/SQL failures and bounds fair processing rounds', async () => {
  await expect(new WakeCoordinator(async () => {throw new Error('bad SQL');}).run(new AbortController().signal)).rejects.toThrow('bad SQL');
  const first=vi.fn(async()=>true), second=vi.fn(async()=>false);
  expect(await drainQueues([first,second],new AbortController().signal,3)).toBe(true);
  expect(first).toHaveBeenCalledTimes(3);expect(second).toHaveBeenCalledTimes(3);
  first.mockResolvedValue(false);
  expect(await drainQueues([first,second],new AbortController().signal)).toBe(false);
  const stopped=new AbortController();stopped.abort();
  expect(await drainQueues([first],stopped.signal)).toBe(false);
});

it('waits for all in-flight handlers before propagating a failure to pool cleanup', async () => {
  let finish!:()=>void, settled=false;
  const slow=new Promise<void>(resolve=>{finish=resolve;});
  const running=drainQueues([async()=>{throw new Error('failure');},async()=>{await slow;settled=true;return false;}],new AbortController().signal);
  const assertion=expect(running).rejects.toThrow('failure');
  await Promise.resolve();expect(settled).toBe(false);
  finish();await assertion;expect(settled).toBe(true);
});
