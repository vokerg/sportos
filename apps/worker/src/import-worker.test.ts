import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(), destroy: vi.fn(),
  imports: vi.fn(), rules: vi.fn(), strava: vi.fn(), garmin: vi.fn(),
  importRun: vi.fn(), ruleRun: vi.fn(), stravaRun: vi.fn(), garminRun: vi.fn(),
  storage: vi.fn(),
}));
vi.mock('@sportos/db', () => ({ createDb: mocks.createDb, loadEnvFromNearestFile: vi.fn() }));
vi.mock('@sportos/importers', () => ({
  LocalUploadStorage: mocks.storage,
  CredentialCipher: vi.fn(), GarminSessionCipher: vi.fn(), StravaAdapter: vi.fn(),
  parseCredentialKeyRing: vi.fn(),
}));
vi.mock('./import-job-runner.js', () => ({ ImportJobRunner: mocks.imports }));
vi.mock('./rule-change-runner.js', () => ({ RuleChangeRunner: mocks.rules }));
vi.mock('./provider-sync-runner.js', () => ({ ProviderSyncRunner: mocks.strava }));
vi.mock('./garmin-job-runner.js', () => ({ GarminJobRunner: mocks.garmin }));

let signalListeners: Record<'SIGINT' | 'SIGTERM', Function[]>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  signalListeners = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
  mocks.createDb.mockImplementation(() => ({ destroy: mocks.destroy }));
  mocks.destroy.mockResolvedValue(undefined);
  for (const [constructor, run] of [
    [mocks.imports, mocks.importRun], [mocks.rules, mocks.ruleRun],
    [mocks.strava, mocks.stravaRun], [mocks.garmin, mocks.garminRun],
  ]) {
    run.mockResolvedValue(undefined);
    constructor.mockImplementation(() => ({ run }));
  }
  vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED', undefined);
  vi.stubEnv('IMPORT_WORKER_CONCURRENCY', '2');
  vi.stubEnv('SPORTOS_WORKER_DATABASE_URL', 'postgresql://dispatcher:example@primary.example/db');
  vi.stubEnv('SPORTOS_WORKER_DATA_DATABASE_URL', 'postgresql://worker:example@primary.example/db');
  vi.stubEnv('SPORTOS_ACTIVITY_DETAIL_WORKER_DATA_DATABASE_URL', 'postgresql://worker:example@detail.example/db');
  vi.stubEnv('SPORTOS_GARMIN_WORKER_ENABLED', 'true');
  vi.stubEnv('STRAVA_CLIENT_ID', 'synthetic-client');
  vi.stubEnv('STRAVA_CLIENT_SECRET', 'synthetic-secret');
  vi.stubEnv('SPORTOS_PROVIDER_CREDENTIAL_KEYS', 'synthetic-key-ring');
  vi.stubEnv('SPORTOS_PROVIDER_ACTIVE_KEY_ID', 'synthetic-key-id');
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
});

describe('worker queue selection at the real entry point', () => {
  it.each([undefined, 'true'])('preserves existing upload processing when configured as %s', async (value) => {
    vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED', value);
    await import('./import-worker.js');
    expect(mocks.importRun).toHaveBeenCalledTimes(2);
    expect(mocks.ruleRun).toHaveBeenCalledOnce();
    expect(mocks.stravaRun).toHaveBeenCalledOnce();
    expect(mocks.garminRun).toHaveBeenCalledOnce();
  });

  it('does not construct or start upload consumers while providers/rules and Garmin original storage remain available', async () => {
    vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED', 'false');
    await import('./import-worker.js');
    expect(mocks.imports).not.toHaveBeenCalled();
    expect(mocks.importRun).not.toHaveBeenCalled();
    expect(mocks.ruleRun).toHaveBeenCalledOnce();
    expect(mocks.stravaRun).toHaveBeenCalledOnce();
    expect(mocks.garminRun).toHaveBeenCalledOnce();
    const signal = mocks.ruleRun.mock.calls[0][0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(mocks.stravaRun).toHaveBeenCalledWith(signal);
    expect(mocks.garminRun).toHaveBeenCalledWith(signal);
    expect(mocks.garmin.mock.calls[0][3]).toBe(mocks.storage.mock.instances[0]);
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
  });

  it.each(['', 'FALSE', '0', 'disabled'])('rejects invalid switch %j before opening any database', async (value) => {
    vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED', value);
    await expect(import('./import-worker.js')).rejects.toThrow('SPORTOS_IMPORT_WORKER_ENABLED must be true or false');
    expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.imports).not.toHaveBeenCalled();
  });
});
