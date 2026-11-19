import { describe, expect, it, vi } from 'vitest';
import { SyncEverything, type SyncTransport, type SyncJob } from './sync-everything.js';
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const job = (n: number, status: SyncJob['status'] = 'succeeded') => ({ id: id(n), status });
function setup() {
  const controller = new AbortController();
  const read = vi.fn(async (path: string): Promise<unknown> => {
    if (path === '/providers/connections') return [{ id: id(1), provider: 'strava', status: 'connected', lastSyncAt: '2026-11-18' }];
    if (path.includes('/providers/connections/')) return [];
    if (path === '/garmin/connection') return { enabled: true, activeJob: null };
    if (path === '/daily/recalculation') return { activeJob: null, latestJob: null };
    return job(2);
  });
  const post = vi.fn(async () => job(2));
  const api: SyncTransport = { signal: controller.signal, read, post, watch: async initial => initial };
  return { workflow: new SyncEverything(), api, read, post, controller };
}
describe('explicit Update everything workflow', () => {
  it('does nothing on creation, serializes all stages and permits ten repeated runs', async () => {
    const { workflow, api, post } = setup();
    expect(post).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i++) {
      expect(await workflow.run(api, () => {})).toBe(true);
      expect(workflow.view.status).toBe('done');
    }
    expect(post.mock.calls.map(call => (call as unknown[])[0])).toEqual(Array.from({ length: 10 }, () => [
      '/providers/connections/' + id(1) + '/sync', '/garmin/sync', '/daily/recalculation',
    ]).flat());
    expect(post.mock.calls[0]).toEqual(['/providers/connections/' + id(1) + '/sync', { mode: 'incremental' }]);
  });
  it('guards simultaneous clicks and waits for actual success before Garmin', async () => {
    const { workflow, api, post } = setup();
    let release!: (job: SyncJob) => void;
    api.watch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockImplementation(async initial => initial);
    const first = workflow.run(api, () => {});
    expect(await workflow.run(api, () => {})).toBe(false);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    release(job(2));
    expect(await first).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it.each(['failed', 'cancelled'] as const)('stops after %s and retries only the failed stage', async status => {
    const { workflow, api, post } = setup();
    post.mockResolvedValueOnce(job(2)).mockResolvedValueOnce(job(3, status));
    expect(await workflow.run(api, () => {})).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
    expect(workflow.view.message).toContain('Later stages have not started');
    expect(await workflow.run(api, () => {})).toBe(true);
    expect(post.mock.calls.slice(2).map(call => (call as unknown[])[0])).toEqual(['/garmin/sync', '/daily/recalculation']);
  });
  it('pauses and continues the same job without another enqueue', async () => {
    const { workflow, api, post } = setup();
    api.watch = vi.fn().mockResolvedValueOnce(null).mockImplementation(async initial => initial);
    expect(await workflow.run(api, () => {})).toBe(false);
    expect(workflow.view.status).toBe('paused');
    expect(await workflow.run(api, () => {})).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it('adopts a running Strava import instead of conflicting with it', async () => {
    const { workflow, api, read, post } = setup();
    const original = read.getMockImplementation()!;
    read.mockImplementation(async path => path.includes('/providers/connections/') ? [{ ...job(4, 'running'), connectionId: id(1), mode: 'incremental' }] : original(path));
    api.watch = async initial => ({ ...initial, status: 'succeeded' });
    expect(await workflow.run(api, () => {})).toBe(true);
    expect(post.mock.calls.map(call => (call as unknown[])[0])).toEqual(['/garmin/sync', '/daily/recalculation']);
  });
  it('recovers an ambiguous Strava enqueue even when it has already succeeded', async () => {
    const { workflow, api, read, post } = setup();
    post.mockRejectedValueOnce(new Error('private payload'));
    expect(await workflow.run(api, () => {})).toBe(false);
    expect(workflow.view.message).not.toContain('private payload');
    const original = read.getMockImplementation()!;
    read.mockImplementation(async path => path.includes('/providers/connections/') ? [{ ...job(4), connectionId: id(1), mode: 'incremental' }] : original(path));
    expect(await workflow.run(api, () => {})).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it('waits for targeted Garmin work, including a pause, then starts a general sync', async () => {
    const { workflow, api, read, post } = setup();
    const original = read.getMockImplementation()!;
    read.mockImplementation(async path => path === '/garmin/connection' ? { enabled: true, activeJob: { ...job(4, 'running'), operation: 'day' } } : original(path));
    api.watch = vi.fn().mockResolvedValueOnce(job(2)).mockResolvedValueOnce(null).mockImplementation(async initial => ({ ...initial, status: 'succeeded' }));
    expect(await workflow.run(api, () => {})).toBe(false);
    expect(workflow.view.stage).toBe('garmin');
    expect(post).toHaveBeenCalledTimes(1);
    expect(await workflow.run(api, () => {})).toBe(true);
    expect(post.mock.calls.map(call => (call as unknown[])[0])).toEqual(['/providers/connections/' + id(1) + '/sync', '/garmin/sync', '/daily/recalculation']);
  });
  it('does not treat an earlier calculation as recalculation of just-imported evidence', async () => {
    const { workflow, api, read, post } = setup();
    const original = read.getMockImplementation()!;
    read.mockImplementation(async path => path === '/daily/recalculation' ? { activeJob: job(4, 'running') } : original(path));
    const watch = vi.fn(async initial => ({ ...initial, status: 'succeeded' as const })); api.watch = watch;
    expect(await workflow.run(api, () => {})).toBe(true);
    expect(watch).toHaveBeenCalledTimes(4);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it('blocks unavailable Garmin before any write and never reveals raw errors', async () => {
    const { workflow, api, read, post } = setup();
    read.mockResolvedValue({ enabled: false });
    expect(await workflow.run(api, () => {})).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(workflow.view.message).toContain('Garmin is unavailable');
  });
  it('aborts before the next stage and rejects mismatched polled IDs', async () => {
    const { workflow, api, controller, post } = setup();
    api.watch = async initial => { controller.abort(); return initial; };
    expect(await workflow.run(api, () => {})).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    const other = setup(); other.api.watch = async () => job(99);
    expect(await other.workflow.run(other.api, () => {})).toBe(false);
    expect(other.post).toHaveBeenCalledTimes(1);
  });
});
