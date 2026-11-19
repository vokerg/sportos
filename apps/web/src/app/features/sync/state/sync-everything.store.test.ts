import '@angular/compiler';
import { afterEach, expect, it, vi } from 'vitest';
import { SyncEverythingStore } from './sync-everything.store';
const id = '00000000-0000-4000-8000-000000000001';
const queued = { id, status: 'queued' };
const done = { id, status: 'succeeded' };
function setup() {
  const api = {
    read: vi.fn(async (path: string): Promise<unknown> => {
      if (path === '/providers/connections') return [{ id, provider: 'strava', status: 'connected', lastSyncAt: '2026-11-18' }];
      if (path.includes('/connections/')) return [];
      if (path === '/garmin/connection') return { enabled: true, activeJob: null };
      if (path === '/daily/recalculation') return { activeJob: null, latestJob: null };
      return done;
    }),
    post: vi.fn(async () => queued),
  };
  return { api, store: new SyncEverythingStore(api as never) };
}
afterEach(() => vi.useRealTimers());
it('makes no navigation requests, locks clicks synchronously and refreshes only after all three successful jobs', async () => {
  vi.useFakeTimers();
  const { api, store } = setup();
  expect(api.read).not.toHaveBeenCalled();
  const first = store.start();
  expect(store.busy()).toBe(true);
  expect(await store.start()).toBe(false);
  await vi.runAllTimersAsync();
  expect(await first).toBe(true);
  expect(api.post.mock.calls.map(call => (call as unknown[])[0])).toEqual(['/providers/connections/' + id + '/sync', '/garmin/sync', '/daily/recalculation']);
  expect(store.busy()).toBe(false);
  expect(store.label()).toBe('Update everything');
});
it('bounds polling and continues the existing job without another Strava POST', async () => {
  vi.useFakeTimers();
  const { api, store } = setup();
  const original = api.read.getMockImplementation()!;
  api.read.mockImplementation(async path => path.includes('/jobs/') ? queued : original(path));
  const first = store.start();
  await vi.runAllTimersAsync();
  expect(await first).toBe(false);
  expect(store.view().status).toBe('paused');
  expect(api.read.mock.calls.filter(([p]) => p.includes('/jobs/'))).toHaveLength(240);
  expect(api.post).toHaveBeenCalledTimes(1);
  api.read.mockImplementation(original);
  const resumed = store.start();
  await vi.runAllTimersAsync();
  expect(await resumed).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});
it('teardown stops polling and prevents every downstream write', async () => {
  vi.useFakeTimers();
  const { api, store } = setup();
  const original = api.read.getMockImplementation()!;
  api.read.mockImplementation(async path => path.includes('/jobs/') ? queued : original(path));
  const run = store.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.post).toHaveBeenCalledTimes(1);
  store.ngOnDestroy();
  expect(await run).toBe(false);
  await vi.runAllTimersAsync();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(await store.start()).toBe(false);
});
