import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const { read, mutate } = vi.hoisted(() => ({ read: vi.fn(), mutate: vi.fn() }));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) }));
vi.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ read, mutate }) }));
vi.mock('../src/ui/primitives', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { Card: Container, Body: Container, Action: (p: object) => React.createElement('Action', p) };
});
import { SyncEverythingCard } from '../src/sync/SyncEverythingCard';
const id = '00000000-0000-4000-8000-000000000001';
const queued = { id, status: 'queued' }, done = { id, status: 'succeeded' };
let tree: ReactTestRenderer | null = null;
const button = () => tree!.root.findByType('Action' as never);
async function mount() {
  const updated = vi.fn();
  read.mockImplementation(async (path: string) => {
    if (path === '/providers/connections') return [{ id, provider: 'strava', status: 'connected', lastSyncAt: '2026-11-18' }];
    if (path.includes('/connections/')) return [];
    if (path === '/garmin/connection') return { enabled: true, activeJob: null };
    if (path === '/daily/recalculation') return { activeJob: null, latestJob: null };
    return done;
  });
  mutate.mockResolvedValue(queued);
  await act(async () => { tree = create(<SyncEverythingCard onUpdated={updated}/>); });
  return updated;
}
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = null; vi.clearAllMocks(); vi.useRealTimers(); });
it('renders one action, never syncs on navigation and allows ten completed updates with duplicate-click protection', async () => {
  vi.useFakeTimers(); const updated = await mount();
  expect(read).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  for (let i = 0; i < 10; i++) {
    await act(async () => { button().props.onPress(); button().props.onPress(); });
    expect(button().props.disabled).toBe(true);
    expect(mutate).toHaveBeenCalledTimes(i * 3 + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(button().props.title).toBe('Update everything');
    expect(button().props.disabled).toBe(false);
  }
  expect(updated).toHaveBeenCalledTimes(10);
  expect(mutate.mock.calls.slice(0, 3).map(([p]) => p)).toEqual(['/providers/connections/' + id + '/sync', '/garmin/sync', '/daily/recalculation']);
});
it('keeps a pending job for manual continuation and cancels observation on teardown', async () => {
  vi.useFakeTimers(); await mount();
  const original = read.getMockImplementation()!;
  read.mockImplementation(async (path: string) => path.includes('/jobs/') ? queued : original(path));
  await act(async () => button().props.onPress());
  await act(async () => { await vi.advanceTimersByTimeAsync(125000); });
  expect(button().props.title).toBe('Continue update');
  expect(read.mock.calls.filter(([p]) => p.includes('/jobs/'))).toHaveLength(24);
  expect(mutate).toHaveBeenCalledTimes(1);
  await act(async () => button().props.onPress());
  const signal = read.mock.calls.at(-1)?.[1] as AbortSignal;
  await act(async () => tree!.unmount()); tree = null;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(mutate).toHaveBeenCalledTimes(1);
});
it('does not recalculate after failure or expose private transport errors', async () => {
  vi.useFakeTimers(); const updated = await mount();
  mutate.mockRejectedValueOnce(new Error('private connection data'));
  await act(async () => button().props.onPress());
  expect(button().props.title).toBe('Continue update');
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(updated).not.toHaveBeenCalled();
  expect(JSON.stringify(tree!.toJSON())).not.toContain('private connection data');
});
