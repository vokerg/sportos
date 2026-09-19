import { Observable, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pollDurableJob, type DurableJobPollState } from './durable-job-poller';

interface TestJob {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
}

const queued: TestJob = { status: 'queued' };
const succeeded: TestJob = { status: 'succeeded' };
const failed: TestJob = { status: 'failed' };
const isTerminal = (job: TestJob) => job.status === 'succeeded' || job.status === 'failed';

afterEach(() => {
  vi.useRealTimers();
});

describe('pollDurableJob', () => {
  it('polls until the feature marks a successful job terminal', async () => {
    vi.useFakeTimers();
    const fetchJob = vi.fn()
      .mockReturnValueOnce(of(queued))
      .mockReturnValueOnce(of(succeeded));
    const states: DurableJobPollState<TestJob>[] = [];

    pollDurableJob(fetchJob, { intervalMs: 1000, maxAttempts: 5, isTerminal }).subscribe((state) => states.push(state));

    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([{ state: 'loading', attempt: 1, job: queued }]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toEqual({ state: 'terminal', attempt: 2, job: succeeded });
    expect(fetchJob).toHaveBeenCalledTimes(2);
  });

  it('treats feature-defined failed jobs as terminal without knowing the job model', async () => {
    vi.useFakeTimers();
    const states: DurableJobPollState<TestJob>[] = [];

    pollDurableJob(() => of(failed), { intervalMs: 1000, maxAttempts: 5, isTerminal }).subscribe((state) => states.push(state));
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toEqual([{ state: 'terminal', attempt: 1, job: failed }]);
  });

  it('emits an error state when a status request fails', async () => {
    vi.useFakeTimers();
    const failure = new Error('request failed');
    const states: DurableJobPollState<TestJob>[] = [];

    pollDurableJob(
      () => throwError(() => failure),
      { intervalMs: 1000, maxAttempts: 5, isTerminal },
    ).subscribe((state) => states.push(state));
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toEqual([{ state: 'error', attempt: 1, job: null, error: failure }]);
  });

  it('stops after the configured attempt bound', async () => {
    vi.useFakeTimers();
    const fetchJob = vi.fn(() => of(queued));
    const states: DurableJobPollState<TestJob>[] = [];

    pollDurableJob(fetchJob, { intervalMs: 100, maxAttempts: 2, isTerminal }).subscribe((state) => states.push(state));
    await vi.advanceTimersByTimeAsync(100);

    expect(fetchJob).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toEqual({ state: 'exhausted', attempt: 2, job: queued, reason: 'attempts' });
  });

  it('stops at the configured duration bound without another request', async () => {
    vi.useFakeTimers();
    const fetchJob = vi.fn(() => of(queued));
    const states: DurableJobPollState<TestJob>[] = [];

    pollDurableJob(fetchJob, { intervalMs: 100, maxDurationMs: 250, isTerminal }).subscribe((state) => states.push(state));
    await vi.advanceTimersByTimeAsync(250);

    expect(fetchJob).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toEqual({ state: 'exhausted', attempt: 3, job: queued, reason: 'timeout' });
  });

  it('cancels scheduled and in-flight work when unsubscribed', async () => {
    vi.useFakeTimers();
    const teardown = vi.fn();
    const fetchJob = vi.fn(() => new Observable<TestJob>((subscriber) => {
      subscriber.next(queued);
      return teardown;
    }));

    const subscription = pollDurableJob(
      fetchJob,
      { intervalMs: 1000, maxAttempts: 5, isTerminal },
    ).subscribe();

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJob).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchJob).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
