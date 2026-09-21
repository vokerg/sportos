import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderApiService } from '../data-access/provider-api.service';
import type { ProviderConnection, ProviderSyncJob } from '../model/provider.models';
import { ProviderStore } from './provider.store';

const connection: ProviderConnection = {
  id: '44444444-4444-4444-8444-444444444444',
  provider: 'strava',
  displayName: 'Athlete',
  scopes: ['activity:read_all'],
  status: 'connected',
  accessExpiresAt: null,
  lastSyncAt: null,
  lastAttemptAt: null,
  error: null,
  createdAt: '2026-08-04T18:00:00.000Z',
  updatedAt: '2026-08-04T18:00:00.000Z',
  disconnectedAt: null,
  revokedAt: null,
};

const runningJob: ProviderSyncJob = {
  id: '55555555-5555-4555-8555-555555555555',
  connectionId: connection.id,
  mode: 'incremental',
  batchId: '66666666-6666-4666-8666-666666666666',
  status: 'running',
  phase: 'fetching-page-1',
  progressPercent: 20,
  attemptCount: 1,
  maxAttempts: 5,
  cancellationRequested: false,
  requestedAfter: null,
  requestedBefore: null,
  error: null,
  result: {},
  createdAt: '2026-08-04T19:00:00.000Z',
  updatedAt: '2026-08-04T19:00:00.000Z',
  startedAt: '2026-08-04T19:00:00.000Z',
  completedAt: null,
};

const succeededJob: ProviderSyncJob = {
  ...runningJob,
  status: 'succeeded',
  phase: 'completed',
  progressPercent: 100,
  completedAt: '2026-08-04T19:02:00.000Z',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('ProviderStore', () => {
  it('recovers an active job and follows it to a terminal state with the shared poller', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.syncJob.mockReturnValue(of(succeededJob));
    const store = new ProviderStore(api as unknown as ProviderApiService);

    store.initialize();
    expect(store.connection()).toEqual(connection);
    expect(store.job()).toEqual(runningJob);

    await vi.runAllTimersAsync();

    expect(api.syncJobs).toHaveBeenCalledWith(connection.id, 1);
    expect(api.syncJob).toHaveBeenCalledWith(runningJob.id);
    expect(store.job()?.status).toBe('succeeded');
    expect(store.state()).toBe('ready');
    expect(store.pollingPaused()).toBe(false);
    store.ngOnDestroy();
  });

  it('cancels a stale post-terminal connection refresh when a newer load replaces it', async () => {
    vi.useFakeTimers();
    const staleRefresh = new Subject<ProviderConnection[]>();
    const api = createApi();
    api.connections
      .mockReturnValueOnce(of([connection]))
      .mockReturnValueOnce(staleRefresh.asObservable())
      .mockReturnValueOnce(of([]));
    api.syncJob.mockReturnValue(of(succeededJob));
    const store = new ProviderStore(api as unknown as ProviderApiService);

    store.initialize();
    await vi.runAllTimersAsync();

    expect(api.connections).toHaveBeenCalledTimes(2);

    store.load();

    expect(store.connection()).toBeNull();
    staleRefresh.next([connection]);
    expect(store.connection()).toBeNull();
    store.ngOnDestroy();
  });

  it('requests cooperative cancellation and preserves the terminal job', () => {
    const cancelled = {
      ...runningJob,
      status: 'cancelled' as const,
      phase: 'cancelled',
      cancellationRequested: true,
      completedAt: '2026-08-04T19:01:00.000Z',
    };
    const api = createApi();
    api.cancelSync.mockReturnValue(of(cancelled));
    const store = new ProviderStore(api as unknown as ProviderApiService);
    store.connection.set(connection);
    store.job.set(runningJob);

    store.cancel();

    expect(api.cancelSync).toHaveBeenCalledWith(runningJob.id);
    expect(store.job()).toEqual(cancelled);
    expect(store.busy()).toBe(false);
    store.ngOnDestroy();
  });

  it('retries a failed job and resumes bounded polling', async () => {
    vi.useFakeTimers();
    const failed = {
      ...runningJob,
      status: 'failed' as const,
      phase: 'failed',
      error: { code: 'ERROR', message: 'sanitized failure' },
    };
    const api = createApi();
    api.retrySync.mockReturnValue(of(runningJob));
    api.syncJob.mockReturnValue(of(succeededJob));
    const store = new ProviderStore(api as unknown as ProviderApiService);
    store.connection.set(connection);
    store.job.set(failed);

    store.retry();
    await vi.runAllTimersAsync();

    expect(api.retrySync).toHaveBeenCalledWith(failed.id);
    expect(store.job()?.status).toBe('succeeded');
    expect(store.state()).toBe('ready');
    store.ngOnDestroy();
  });

  it('normalizes provider request failures at the state boundary', () => {
    const api = createApi();
    api.connections.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 503,
      error: { message: 'Provider service is unavailable.' },
    })));
    const store = new ProviderStore(api as unknown as ProviderApiService);

    store.initialize();

    expect(store.state()).toBe('error');
    expect(store.errorMessage()).toBe('Provider service is unavailable.');
    store.ngOnDestroy();
  });
});

function createApi() {
  return {
    connections: vi.fn().mockReturnValue(of([connection])),
    startStrava: vi.fn().mockReturnValue(of({ authorizationUrl: 'https://www.strava.com/oauth/authorize' })),
    enqueueSync: vi.fn().mockReturnValue(of(runningJob)),
    syncJobs: vi.fn().mockReturnValue(of([runningJob])),
    syncJob: vi.fn().mockReturnValue(of(succeededJob)),
    retrySync: vi.fn().mockReturnValue(of(runningJob)),
    cancelSync: vi.fn().mockReturnValue(of({ ...runningJob, status: 'cancelled' as const })),
    disconnect: vi.fn().mockReturnValue(of({ disconnected: true as const })),
  };
}
