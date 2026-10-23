import { setTimeout as delay } from 'node:timers/promises';
import { isDatabaseConnectionError } from '@sportos/db';

/** Retry the queue scan, never a SQL statement or an in-memory claimed job. */
export async function runPollingLoop(
  processNext: () => Promise<boolean>,
  pollIntervalMs: number,
  signal: AbortSignal,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    let waitMs = pollIntervalMs;
    try {
      const processed = await processNext();
      if (failures > 0) console.info('Worker database connection recovered.');
      failures = 0;
      if (processed) continue;
    } catch (error) {
      if (!isDatabaseConnectionError(error)) throw error;
      // An interrupted claimed job remains governed by persisted lease recovery.
      // Do not replay its callback with the old claim or increment retries here.
      waitMs = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5));
      console.warn(`Worker database unavailable; retrying queue scan in ${waitMs} ms.`);
    }
    try {
      await delay(waitMs, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
