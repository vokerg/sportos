import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createDb } from '@sportos/db';
import { LocalUploadStorage } from '@sportos/importers';
import { CredentialCipher, StravaAdapter, parseCredentialKeyRing } from '@sportos/providers';
import { ImportJobRunner } from './import-job-runner.js';
import { ProviderSyncRunner } from './provider-sync-runner.js';
import { RuleChangeRunner } from './rule-change-runner.js';

const concurrency = clampInteger(Number(process.env.IMPORT_WORKER_CONCURRENCY ?? 1), 1, 4);
const leaseSeconds = clampInteger(Number(process.env.IMPORT_JOB_LEASE_SECONDS ?? 60), 15, 600);
const pollIntervalMs = clampInteger(Number(process.env.IMPORT_JOB_POLL_MS ?? 1000), 100, 60_000);
const processId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const controller = new AbortController();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

const dispatchDb = createDb(requiredUrl('SPORTOS_WORKER_DATABASE_URL'));
const dataDb = createDb(requiredUrl('SPORTOS_WORKER_DATA_DATABASE_URL'));
const storage = new LocalUploadStorage();

try {
  const runners: Promise<void>[] = [
    ...Array.from({ length: concurrency }, (_, index) => new ImportJobRunner(dispatchDb, dataDb, storage, {
      workerId: `${processId}:import:${index + 1}`,
      leaseSeconds,
      pollIntervalMs,
    }).run(controller.signal)),
    new RuleChangeRunner(dispatchDb, dataDb, {
      workerId: `${processId}:rules`,
      leaseSeconds,
      pollIntervalMs,
    }).run(controller.signal),
  ];

  const provider = providerRuntime();
  if (provider) {
    runners.push(new ProviderSyncRunner(dispatchDb, dataDb, provider.adapter, provider.cipher, {
      workerId: `${processId}:providers`,
      leaseSeconds,
      pollIntervalMs,
      pageSize: 200,
    }).run(controller.signal));
  }

  await Promise.all(runners);
} finally {
  await Promise.all([dispatchDb.destroy(), dataDb.destroy()]);
}

function providerRuntime(): { adapter: StravaAdapter; cipher: CredentialCipher } | null {
  const names = [
    'STRAVA_CLIENT_ID',
    'STRAVA_CLIENT_SECRET',
    'SPORTOS_PROVIDER_CREDENTIAL_KEYS',
    'SPORTOS_PROVIDER_ACTIVE_KEY_ID',
  ] as const;
  const configured = names.filter((name) => Boolean(process.env[name]?.trim()));
  if (configured.length === 0) return null;
  if (configured.length !== names.length) {
    throw new Error(`Provider worker configuration is incomplete; configure all of ${names.join(', ')}.`);
  }
  return {
    adapter: new StravaAdapter({
      clientId: requiredEnvironment('STRAVA_CLIENT_ID'),
      clientSecret: requiredEnvironment('STRAVA_CLIENT_SECRET'),
      authorizationBaseUrl: process.env.STRAVA_AUTH_BASE_URL,
      apiBaseUrl: process.env.STRAVA_API_BASE_URL,
    }),
    cipher: new CredentialCipher(parseCredentialKeyRing(
      requiredEnvironment('SPORTOS_PROVIDER_CREDENTIAL_KEYS'),
      requiredEnvironment('SPORTOS_PROVIDER_ACTIVE_KEY_ID'),
    )),
  };
}

function requiredUrl(name: 'SPORTOS_WORKER_DATABASE_URL' | 'SPORTOS_WORKER_DATA_DATABASE_URL'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; the worker must not fall back to API or schema-owner credentials.`);
  return value;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for provider sync.`);
  return value;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
