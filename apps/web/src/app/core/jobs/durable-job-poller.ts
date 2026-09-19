import { Observable, Subscription, take } from 'rxjs';

export type DurableJobPollExhaustionReason = 'attempts' | 'timeout';

export type DurableJobPollState<T> =
  | { state: 'loading'; attempt: number; job: T }
  | { state: 'terminal'; attempt: number; job: T }
  | { state: 'error'; attempt: number; job: T | null; error: unknown }
  | { state: 'exhausted'; attempt: number; job: T | null; reason: DurableJobPollExhaustionReason };

export interface DurableJobPollOptions<T> {
  intervalMs: number;
  maxAttempts?: number;
  maxDurationMs?: number;
  isTerminal: (job: T) => boolean;
}

export function pollDurableJob<T>(
  fetchJob: () => Observable<T>,
  options: DurableJobPollOptions<T>,
): Observable<DurableJobPollState<T>> {
  validateOptions(options);

  return new Observable<DurableJobPollState<T>>((subscriber) => {
    const startedAt = Date.now();
    let attempt = 0;
    let lastJob: T | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestSubscription: Subscription | undefined;
    let disposed = false;

    const exhaust = (reason: DurableJobPollExhaustionReason): void => {
      if (disposed || subscriber.closed) return;
      subscriber.next({ state: 'exhausted', attempt, job: lastJob, reason });
      subscriber.complete();
    };

    const remainingDuration = (): number | null => {
      if (options.maxDurationMs === undefined) return null;
      return options.maxDurationMs - (Date.now() - startedAt);
    };

    const schedule = (delayMs: number): void => {
      if (disposed || subscriber.closed) return;
      if (options.maxAttempts !== undefined && attempt >= options.maxAttempts) {
        exhaust('attempts');
        return;
      }

      const remaining = remainingDuration();
      if (remaining !== null && remaining <= 0) {
        exhaust('timeout');
        return;
      }

      const boundedDelay = remaining === null ? delayMs : Math.min(delayMs, remaining);
      timer = setTimeout(run, boundedDelay);
    };

    const run = (): void => {
      timer = undefined;
      if (disposed || subscriber.closed) return;

      const remaining = remainingDuration();
      if (remaining !== null && remaining <= 0) {
        exhaust('timeout');
        return;
      }
      if (options.maxAttempts !== undefined && attempt >= options.maxAttempts) {
        exhaust('attempts');
        return;
      }

      attempt += 1;
      let receivedJob = false;
      requestSubscription = fetchJob().pipe(take(1)).subscribe({
        next: (job) => {
          receivedJob = true;
          lastJob = job;
          if (options.isTerminal(job)) {
            subscriber.next({ state: 'terminal', attempt, job });
            subscriber.complete();
            return;
          }

          subscriber.next({ state: 'loading', attempt, job });
          schedule(options.intervalMs);
        },
        error: (error: unknown) => {
          subscriber.next({ state: 'error', attempt, job: lastJob, error });
          subscriber.complete();
        },
        complete: () => {
          if (!receivedJob && !subscriber.closed) {
            subscriber.next({
              state: 'error',
              attempt,
              job: lastJob,
              error: new Error('Durable job polling request completed without a job value.'),
            });
            subscriber.complete();
          }
        },
      });
    };

    schedule(0);

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      requestSubscription?.unsubscribe();
      requestSubscription = undefined;
    };
  });
}

function validateOptions<T>(options: DurableJobPollOptions<T>): void {
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 0) {
    throw new Error('Durable job polling intervalMs must be a finite non-negative number.');
  }
  if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0)) {
    throw new Error('Durable job polling maxAttempts must be a positive integer.');
  }
  if (options.maxDurationMs !== undefined && (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0)) {
    throw new Error('Durable job polling maxDurationMs must be a finite positive number.');
  }
  if (options.maxAttempts === undefined && options.maxDurationMs === undefined) {
    throw new Error('Durable job polling requires maxAttempts or maxDurationMs.');
  }
}
