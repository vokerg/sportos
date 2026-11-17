import {parseWakeKeys, signWake, wakeEndpoint, WAKE_BODY, WAKE_HEADER, type WakeKeys} from '@sportos/worker-wake';

type Environment = Record<string, string | undefined>;
let cached: {source: string; keys: Promise<WakeKeys>} | undefined;
function keys(source: string): Promise<WakeKeys> {
  if (cached?.source !== source) cached = {source, keys: parseWakeKeys(source)};
  return cached!.keys;
}

export function garminExecutionEnabled(env: Environment = process.env): boolean | undefined {
  const value = env.SPORTOS_GARMIN_EXECUTION_ENABLED;
  if (value === undefined) return undefined; // Staged compatibility with legacy heartbeat deployments.
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('SPORTOS_GARMIN_EXECUTION_ENABLED must be true or false.');
}

export async function validateWorkerWakeEnvironment(env: Environment = process.env): Promise<void> {
  garminExecutionEnabled(env);
  if (!env.SPORTOS_WORKER_WAKE_URL) return;
  wakeEndpoint(env.SPORTOS_WORKER_WAKE_URL);
  const ring = await keys(env.SPORTOS_WORKER_WAKE_KEYS ?? '');
  if (!ring.has(env.SPORTOS_WORKER_WAKE_ACTIVE_KEY_ID ?? '')) throw new Error('Worker wake active key is unavailable.');
}

export async function notifyWorker(env: Environment = process.env, fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.SPORTOS_WORKER_WAKE_URL) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 3000);
  try {
    const endpoint = wakeEndpoint(env.SPORTOS_WORKER_WAKE_URL);
    const ring = await keys(env.SPORTOS_WORKER_WAKE_KEYS ?? '');
    const signature = await signWake(ring, env.SPORTOS_WORKER_WAKE_ACTIVE_KEY_ID ?? '');
    const response = await fetcher(endpoint, {method: 'POST', body: WAKE_BODY, headers: {[WAKE_HEADER]: signature, 'content-type': 'application/json'}, signal: abort.signal, redirect: 'manual'});
    await response.body?.cancel();
    if (response.status !== 202) throw new Error('Wake not acknowledged.');
  } finally { clearTimeout(timer); }
}

/** Await the repository AND account-context release before notifying. Never undo a committed job. */
export async function afterWorkerMutation<T>(operation: Promise<T>, notify: () => Promise<void> = notifyWorker): Promise<T> {
  const result = await operation;
  if (result !== null) {
    try { await notify(); }
    catch { console.warn('Worker wake unavailable; the committed request remains subject to durable recovery.'); }
  }
  return result;
}
