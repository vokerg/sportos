import {isDatabaseConnectionError} from '@sportos/db';

export const RECOVERY_INTERVAL_MS = 60 * 60_000;

/** A wake requests a scan; persisted leases and deadlines remain authoritative. */
export class WakeCoordinator {
  private pending = true;
  private interrupt: (() => void) | undefined;
  private nextAt = Date.now();
  private lastAttempt = -Infinity;
  private failures = 0;
  constructor(private readonly pass: (signal: AbortSignal) => Promise<Date | null>, private readonly recoveryMs = RECOVERY_INTERVAL_MS) {}

  wake(): void {
    this.pending = true;
    // An explicit hint can accelerate outage recovery, at most once per minute.
    this.nextAt = Math.min(this.nextAt, this.failures ? Math.max(Date.now(), this.lastAttempt + 60_000) : Date.now());
    this.interrupt?.();
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if (this.nextAt > Date.now()) { await this.wait(this.nextAt - Date.now(), signal); continue; }
      this.pending = false;
      this.lastAttempt = Date.now();
      try {
        const due = await this.pass(signal);
        this.failures = 0;
        this.nextAt = this.pending ? Date.now() : Math.max(Date.now() + 250, Math.min(Date.now() + this.recoveryMs, due?.getTime() ?? Infinity));
      } catch (error) {
        if (!isDatabaseConnectionError(error)) throw error;
        this.failures++;
        this.nextAt = Date.now() + Math.min(this.recoveryMs, 1000 * 2 ** Math.min(this.failures - 1, 20));
        if (this.pending) this.nextAt = Math.min(this.nextAt, this.lastAttempt + 60_000);
        console.warn('Worker database unavailable; connections released until the next bounded scan.');
      }
    }
  }

  private wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.interrupt = undefined; signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      this.interrupt = finish;
      signal.addEventListener('abort', finish, {once: true});
      if (signal.aborted) finish();
    });
  }
}
