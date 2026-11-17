import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(), destroy: vi.fn(),
  imports: vi.fn(), rules: vi.fn(), strava: vi.fn(), garmin: vi.fn(), calculation:vi.fn(),
  importRun: vi.fn(), ruleRun: vi.fn(), stravaRun: vi.fn(), garminRun: vi.fn(), calculationRun:vi.fn(),
  storage: vi.fn(),
  bridge:vi.fn(), bridgeCheck:vi.fn(), createPass:vi.fn(), coordinator:vi.fn(), coordinatorRun:vi.fn(), wake:vi.fn(), listener:vi.fn(),
  listen:vi.fn(), once:vi.fn(), removeListener:vi.fn(), close:vi.fn(), closeAll:vi.fn(),
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
vi.mock('./garmin-job-runner.js', () => ({ GarminJobRunner: mocks.garmin,PythonGarminBridge:mocks.bridge }));
vi.mock('./daily-recalculation-runner.js',()=>({DailyRecalculationRunner:mocks.calculation}));
vi.mock('./worker-pass.js',()=>({createWorkerPass:mocks.createPass}));
vi.mock('./wake-coordinator.js',()=>({WakeCoordinator:mocks.coordinator}));
vi.mock('./wake-listener.js',()=>({createWakeListener:mocks.listener}));

let signalListeners: Record<'SIGINT' | 'SIGTERM', Function[]>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  signalListeners = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
  mocks.createDb.mockImplementation(() => ({ destroy: mocks.destroy }));
  mocks.destroy.mockResolvedValue(undefined);
  mocks.bridge.mockImplementation(()=>({check:mocks.bridgeCheck}));mocks.bridgeCheck.mockResolvedValue(undefined);
  mocks.createPass.mockReturnValue(vi.fn());mocks.coordinator.mockImplementation(()=>({run:mocks.coordinatorRun,wake:mocks.wake}));mocks.coordinatorRun.mockResolvedValue(undefined);
  mocks.listener.mockReturnValue({once:mocks.once,removeListener:mocks.removeListener,listen:mocks.listen,close:mocks.close,closeAllConnections:mocks.closeAll});
  mocks.listen.mockImplementation((_port:number,_host:string,ready:()=>void)=>ready());mocks.close.mockImplementation((done:()=>void)=>done());
  for (const [constructor, run] of [
    [mocks.imports, mocks.importRun], [mocks.rules, mocks.ruleRun],
    [mocks.strava, mocks.stravaRun], [mocks.garmin, mocks.garminRun],
    [mocks.calculation,mocks.calculationRun],
  ]) {
    run.mockResolvedValue(undefined);
    constructor.mockImplementation(() => ({ run }));
  }
  vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED', undefined);
  vi.stubEnv('SPORTOS_WORKER_MODE',undefined);
  vi.stubEnv('SPORTOS_WORKER_WAKE_KEYS',`one=${btoa('a'.repeat(32))}`);
  vi.stubEnv('SPORTOS_WORKER_WAKE_PORT','3113');
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
    expect(mocks.calculationRun).toHaveBeenCalledOnce();
  });

  it('does not construct or start upload consumers while providers/rules and Garmin original storage remain available', async () => {
    vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED', 'false');
    await import('./import-worker.js');
    expect(mocks.imports).not.toHaveBeenCalled();
    expect(mocks.importRun).not.toHaveBeenCalled();
    expect(mocks.ruleRun).toHaveBeenCalledOnce();
    expect(mocks.stravaRun).toHaveBeenCalledOnce();
    expect(mocks.garminRun).toHaveBeenCalledOnce();
    expect(mocks.calculationRun).toHaveBeenCalledOnce();
    const signal = mocks.ruleRun.mock.calls[0][0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(mocks.stravaRun).toHaveBeenCalledWith(signal);
    expect(mocks.garminRun).toHaveBeenCalledWith(signal);
    expect(mocks.calculationRun).toHaveBeenCalledWith(signal);
    expect(mocks.garmin.mock.calls[0][3]).toBe(mocks.storage.mock.instances[0]);
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
  });

  it.each(['', 'FALSE', '0', 'disabled'])('rejects invalid switch %j before opening any database', async (value) => {
    vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED', value);
    await expect(import('./import-worker.js')).rejects.toThrow('SPORTOS_IMPORT_WORKER_ENABLED must be true or false');
    expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.imports).not.toHaveBeenCalled();
  });
  it('starts wake mode on loopback without opening idle pools or starting legacy loops',async()=>{
    vi.stubEnv('SPORTOS_WORKER_MODE','wake');vi.stubEnv('SPORTOS_IMPORT_WORKER_ENABLED','false');
    await import('./import-worker.js');
    expect(mocks.bridgeCheck).toHaveBeenCalledOnce();expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.importRun).not.toHaveBeenCalled();expect(mocks.garminRun).not.toHaveBeenCalled();expect(mocks.calculationRun).not.toHaveBeenCalled();
    expect(mocks.createPass).toHaveBeenCalledWith(expect.objectContaining({importsEnabled:false,concurrency:2,leaseSeconds:60}));
    expect(mocks.listen).toHaveBeenCalledWith(3113,'127.0.0.1',expect.any(Function));expect(mocks.closeAll).toHaveBeenCalledOnce();expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('cleans up the listener on coordinator failure and fails closed on invalid wake configuration',async()=>{
    vi.stubEnv('SPORTOS_WORKER_MODE','wake');mocks.coordinatorRun.mockRejectedValue(new Error('failure'));
    await expect(import('./import-worker.js')).rejects.toThrow('failure');expect(mocks.close).toHaveBeenCalledOnce();
    vi.resetModules();vi.stubEnv('SPORTOS_WORKER_WAKE_PORT','443');
    await expect(import('./import-worker.js')).rejects.toThrow('Invalid worker wake port');expect(mocks.createDb).not.toHaveBeenCalled();
  });
});
