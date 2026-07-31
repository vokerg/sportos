import { RuleChangeCancelledError, RuleChangesRepository, type Database, type Kysely } from '@sportos/db';

export interface RuleChangeRunnerOptions {
  workerId: string;
  leaseSeconds?: number;
  pollIntervalMs?: number;
}

export class RuleChangeRunner {
  private readonly changes: RuleChangesRepository;
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly db: Kysely<Database>,
    options: RuleChangeRunnerOptions = { workerId: 'sportos-rule-worker' },
  ) {
    this.changes = new RuleChangesRepository(db);
    this.workerId = options.workerId.slice(0, 200);
    this.leaseSeconds = clampInteger(options.leaseSeconds ?? 60, 15, 600);
    this.pollIntervalMs = clampInteger(options.pollIntervalMs ?? 1000, 100, 60_000);
  }

  async processNext(): Promise<boolean> {
    await this.changes.recoverStale();
    const change = await this.changes.claimNext(this.workerId, this.leaseSeconds);
    if (!change) return false;

    try {
      if (await this.changes.cancellationRequested(change.id, this.workerId)) throw new RuleChangeCancelledError();
      await this.changes.heartbeat(change.id, this.workerId, 'activating-rule-version', 25, this.leaseSeconds);
      await this.changes.heartbeat(change.id, this.workerId, 'recomputing-scores', 50, this.leaseSeconds);
      await this.changes.activateAndRecompute(change.id, this.workerId);
      return true;
    } catch (error) {
      const cancelled = error instanceof RuleChangeCancelledError
        || await this.changes.cancellationRequested(change.id, this.workerId).catch(() => false);
      if (cancelled) {
        await this.changes.markCancelled(change.id, this.workerId);
        return true;
      }
      await this.changes.markFailed(change.id, this.workerId, failureCode(error), error);
      return true;
    }
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
