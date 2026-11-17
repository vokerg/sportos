import {createDb, WorkerDispatchRepository, type WorkerQueue} from '@sportos/db';
import {CredentialCipher, GarminSessionCipher, type ProviderAdapter, type UploadStorage} from '@sportos/importers';
import {ImportJobRunner} from './import-job-runner.js';
import {RuleChangeRunner} from './rule-change-runner.js';
import {ProviderSyncRunner} from './provider-sync-runner.js';
import {DailyRecalculationRunner} from './daily-recalculation-runner.js';
import {GarminJobRunner, PythonGarminBridge} from './garmin-job-runner.js';
import {RECOVERY_INTERVAL_MS} from './wake-coordinator.js';

export interface WorkerPassOptions {
  dispatchUrl: string;
  dataUrl: string;
  detailUrl?: string;
  storage: UploadStorage;
  workerId: string;
  importsEnabled: boolean;
  concurrency: number;
  leaseSeconds: number;
  provider: {adapter: ProviderAdapter; cipher: CredentialCipher} | null;
  garminCipher?: GarminSessionCipher;
  garminBridge?: PythonGarminBridge;
}

/** Bounded fair rounds. A future-due job returns false and cannot cause a tight loop. */
export async function drainQueues(handlers: readonly (() => Promise<boolean>)[], signal: AbortSignal, rounds = 25): Promise<boolean> {
  for (let round = 0; round < rounds && !signal.aborted; round++) {
    const results = await Promise.allSettled(handlers.map(handler => signal.aborted ? Promise.resolve(false) : handler()));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (!results.some(result => result.status === 'fulfilled' && result.value)) return false;
  }
  return !signal.aborted;
}

/** Kysely/pg pools are lazy; an idle scan opens only the dispatcher connection. */
export function createWorkerPass(options: WorkerPassOptions): (signal: AbortSignal) => Promise<Date | null> {
  let unclaimable = 0;
  return async signal => {
    const dispatch = createDb(options.dispatchUrl), data = createDb(options.dataUrl);
    const detail = options.detailUrl ? createDb(options.detailUrl) : null;
    try {
      const handlers: (() => Promise<boolean>)[] = [];
      const enabled: WorkerQueue[] = ['scoring_rule_changes', 'daily_recalculation_jobs'];
      if (options.importsEnabled) {
        enabled.push('import_jobs');
        for (let i = 0; i < options.concurrency; i++) {
          const runner = new ImportJobRunner(dispatch, data, options.storage, {workerId: `${options.workerId}:import:${i}`, leaseSeconds: options.leaseSeconds});
          handlers.push(() => signal.aborted ? Promise.resolve(false) : runner.processNext());
        }
      }
      const rules = new RuleChangeRunner(dispatch, data, {workerId: `${options.workerId}:rules`, leaseSeconds: options.leaseSeconds});
      const daily = new DailyRecalculationRunner(dispatch, data, `${options.workerId}:daily`);
      handlers.push(() => signal.aborted ? Promise.resolve(false) : rules.processNext(), () => daily.processNext(signal));
      if (options.provider) {
        enabled.push('provider_sync_jobs');
        const runner = new ProviderSyncRunner(dispatch, data, options.provider.adapter, options.provider.cipher, {workerId: `${options.workerId}:providers`, leaseSeconds: options.leaseSeconds, pageSize: 200});
        handlers.push(() => runner.processNext(signal));
      }
      if (detail && options.garminCipher) {
        enabled.push('garmin_jobs');
        const runner = new GarminJobRunner(dispatch, data, detail, options.storage, options.garminCipher, `${options.workerId}:garmin`, options.garminBridge);
        handlers.push(() => runner.processNext(signal));
      }
      const more = await drainQueues(handlers, signal);
      if (signal.aborted) return null;
      if (more) return new Date(Date.now() + 250);
      const due = await new WorkerDispatchRepository(dispatch).nextWakeAt(enabled);
      if (due && due.getTime() <= Date.now()) {
        // A locked/ineligible overdue row must not turn an empty scan into a busy loop.
        return new Date(Date.now() + Math.min(RECOVERY_INTERVAL_MS, 1000 * 2 ** Math.min(unclaimable++, 20)));
      }
      unclaimable = 0;
      return due;
    } finally {
      const results = await Promise.allSettled([dispatch.destroy(), data.destroy(), detail?.destroy()]);
      if (results.some(result => result.status === 'rejected')) throw new Error('Worker database pool cleanup failed.');
    }
  };
}
