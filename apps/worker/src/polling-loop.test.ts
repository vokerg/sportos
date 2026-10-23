import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPollingLoop } from './polling-loop.js';
import { ImportJobRunner } from './import-job-runner.js';
import { RuleChangeRunner } from './rule-change-runner.js';
import { ProviderSyncRunner } from './provider-sync-runner.js';
import { WorkerDispatchRepository, type Database, type Kysely } from '@sportos/db';
import type { CredentialCipher, ProviderAdapter } from '@sportos/importers';

// node:timers/promises uses native timers; provide controllable abort-aware waits.
vi.mock('node:timers/promises', () => ({
  setTimeout: (ms: number, _: unknown, { signal }: { signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error('aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }),
}));
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const outage = () => Object.assign(new Error('private connection information'), { code: 'ETIMEDOUT' });

it('backs off to 30 seconds, resets on recovery, and aborts pending waits', async () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const controller = new AbortController();
  let calls = 0;
  const scan = vi.fn(async () => { calls++; if (calls === 8) return false; throw outage(); });
  const running = runPollingLoop(scan, 100, controller.signal);
  for (const ms of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    await vi.advanceTimersByTimeAsync(ms - 1);
    const count = scan.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    expect(scan).toHaveBeenCalledTimes(count + 1);
  }
  await vi.advanceTimersByTimeAsync(100);
  expect(warn.mock.calls.at(-1)?.[0]).toContain('1000 ms');
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
  controller.abort();
  await running;
  const count = calls;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toBe(count);
  expect(vi.getTimerCount()).toBe(0);
});

it('surfaces SQL/programming failures without retrying them', async () => {
  const error = Object.assign(new Error('bad SQL'), { code: '42601' });
  const scan = vi.fn().mockRejectedValue(error);
  await expect(runPollingLoop(scan, 100, new AbortController().signal)).rejects.toBe(error);
  expect(scan).toHaveBeenCalledTimes(1);
});

const db = {} as Kysely<Database>;
describe('runner recovery wiring', () => {
  for (const [name, runner] of [
    ['import', new ImportJobRunner(db, db)],
    ['rules', new RuleChangeRunner(db, db)],
  ] as const) {
    it(`${name} survives a failed scan and continues`, async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const controller = new AbortController();
      const scan = vi.spyOn(runner, 'processNext').mockRejectedValueOnce(outage()).mockImplementation(async () => { controller.abort(); return false; });
      const running = runner.run(controller.signal);
      await vi.advanceTimersByTimeAsync(1000);
      await running;
      expect(scan).toHaveBeenCalledTimes(2);
    });
  }
  it('provider discovery survives a failed scan and continues', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const controller = new AbortController();
    const recover = vi.spyOn(WorkerDispatchRepository.prototype, 'recoverStaleProviderSyncs')
      .mockRejectedValueOnce(outage()).mockResolvedValue({ requeued: 0, failed: 0, cancelled: 0 });
    vi.spyOn(WorkerDispatchRepository.prototype, 'claimProviderSync').mockImplementation(async () => { controller.abort(); return null; });
    const runner = new ProviderSyncRunner(db, db, {} as ProviderAdapter, {} as CredentialCipher, { workerId: 'test' });
    const running = runner.run(controller.signal);
    await vi.advanceTimersByTimeAsync(1000);
    await running;
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
