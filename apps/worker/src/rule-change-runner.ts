import {
  RuleChangeCancelledError,
  RuleChangesRepository,
  WorkerDispatchRepository,
  withAccountContext,
  type Database,
  type Kysely,
} from '@sportos/db';

export interface RuleChangeRunnerOptions {
  workerId: string;
  leaseSeconds?: number;
  pollIntervalMs?: number;
}

export class RuleChangeRunner {
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly dispatchDb: Kysely<Database>,
    private readonly dataDb: Kysely<Database>,
    options: RuleChangeRunnerOptions = { workerId: 'sportos-rule-worker' },
  ) {
    this.workerId = options.workerId.slice(0, 200);
    this.leaseSeconds = clampInteger(options.leaseSeconds ?? 60, 15, 600);
    this.pollIntervalMs = clampInteger(options.pollIntervalMs ?? 1000, 100, 60_000);
  }

  async processNext(): Promise<boolean> {
    const dispatcher = new WorkerDispatchRepository(this.dispatchDb);
    await dispatcher.recoverStaleRuleChanges();
    const change = await dispatcher.claimRuleChange(this.workerId, this.leaseSeconds);
    if (!change) return false;

    return withAccountContext(this.dataDb, change.ownerId, async (scopedDb) => {
      const changes = new RuleChangesRepository(scopedDb);
      try {
        if (await changes.cancellationRequested(change.id, this.workerId)) throw new RuleChangeCancelledError();
        await changes.heartbeat(change.id, this.workerId, 'activating-rule-version', 25, this.leaseSeconds);
        await changes.heartbeat(change.id, this.workerId, 'recomputing-scores', 50, this.leaseSeconds);
        await changes.activateAndRecompute(change.id, this.workerId);
        return true;
      } catch (error) {
        const cancelled = error instanceof RuleChangeCancelledError
          || await changes.cancellationRequested(change.id, this.workerId).catch(() => false);
        if (cancelled) {
          await changes.markCancelled(change.id, this.workerId);
          return true;
        }
        await changes.markFailed(change.id, this.workerId, failureCode(error), error);
        return true;
      }
    });
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const processed = await this.processNext();
      if (!processed) await delay(this.pollIntervalMs, signal);
    }
  }
}

function failureCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name.replace(/[^A-Z0-9]+/gi, '_').toUpperCase().slice(0, 120);
  }
  return 'RULE_CHANGE_FAILED';
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
