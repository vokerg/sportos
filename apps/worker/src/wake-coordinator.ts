import {isDatabaseConnectionError} from '@sportos/db';

export const RECOVERY_INTERVAL_MS = 60 * 60_000;

/** A wake requests a scan; persisted leases and deadlines remain authoritative. */
export class WakeCoordinator {
  private pending = true;
  private interrupt: (() => void) | undefined;
  constructor(private readonly pass: (signal: AbortSignal) => Promise<Date | null>, private readonly recoveryMs = RECOVERY_INTERVAL_MS) {}

  wake(): void { this.pending = true; this.interrupt?.(); }

  async run(signal: AbortSignal): Promise<void> {
    let deadline = Date.now(), failures = 0;
    while (!signal.aborted) {
      // A failed connection gets a bounded cooldown even if another hint arrives.
      if ((!this.pending || failures > 0) && deadline > Date.now()) {
        await this.wait(deadline - Date.now(), signal, failures === 0);
      }
      if (signal.aborted) break;
      this.pending = false;
      try {
        const due = await this.pass(signal);
        failures = 0;
        deadline = Math.min(Date.now() + this.recoveryMs, due?.getTime() ?? Infinity);
        // A wake received while processing/closing remains pending for another pass.
        if (this.pending) deadline = Date.now();
        else deadline = Math.max(Date.now() + 250, deadline);
      } catch (error) {
        if (!isDatabaseConnectionError(error)) throw error;
        failures++;
        deadline = Date.now() + Math.min(this.recoveryMs, 1000 * 2 ** Math.min(failures - 1, 20));
        console.warn('Worker database unavailable; connections released until the next bounded scan.');
      }
    }
  }

  private wait(ms: number, signal: AbortSignal, interruptible: boolean): Promise<void> {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.interrupt = undefined; signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      if (interruptible) this.interrupt = finish;
      signal.addEventListener('abort', finish, {once: true});
      if (signal.aborted || (interruptible && this.pending)) finish();
    });
  }
}
