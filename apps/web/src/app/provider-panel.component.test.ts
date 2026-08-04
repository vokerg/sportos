import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderApiService, ProviderConnection, ProviderSyncJob } from './provider-api.service';
import { ProviderPanelComponent, describeError } from './provider-panel.component';

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

function fakeApi(overrides: Partial<Record<keyof ProviderApiService, unknown>> = {}) {
  return {
    connections: vi.fn(() => of([connection])),
    startStrava: vi.fn(() => of({ authorizationUrl: 'https://www.strava.com/oauth/authorize' })),
    enqueueSync: vi.fn(() => of(runningJob)),
    syncJobs: vi.fn(() => of([runningJob])),
    syncJob: vi.fn(() => of(runningJob)),
    retrySync: vi.fn(() => of(runningJob)),
    cancelSync: vi.fn(() => of({ ...runningJob, status: 'cancelled' as const })),
    disconnect: vi.fn(() => of({ disconnected: true as const })),
    ...overrides,
  };
}

describe('ProviderPanelComponent', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recovers the latest active job after reload and resumes status polling', () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const component = new ProviderPanelComponent(api as unknown as ProviderApiService);

    component.load();

    expect(component.connection()).toEqual(connection);
    expect(component.job()).toEqual(runningJob);
    expect(component.busy()).toBe(true);
    expect(api.syncJobs).toHaveBeenCalledWith(connection.id, 1);

    vi.advanceTimersByTime(1500);
    expect(api.syncJob).toHaveBeenCalledWith(runningJob.id);
    component.ngOnDestroy();
  });

  it('allows disconnect while a sync is active so the server can cancel cooperatively', () => {
    const api = fakeApi();
    const component = new ProviderPanelComponent(api as unknown as ProviderApiService);
    component.load();

    component.disconnect();

    expect(api.disconnect).toHaveBeenCalledWith(connection.id);
    expect(api.connections).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  });

  it('renders safe API errors and falls back for unavailable or malformed responses', () => {
    const api = fakeApi({
      connections: vi.fn(() => throwError(() => new HttpErrorResponse({
        status: 503,
        error: { message: 'Provider service is unavailable.' },
      }))),
    });
    const component = new ProviderPanelComponent(api as unknown as ProviderApiService);
    component.load();
    expect(component.errorMessage()).toBe('Provider service is unavailable.');
    expect(component.state()).toBe('error');

    expect(describeError(new HttpErrorResponse({ status: 0 }), 'fallback')).toBe('The SportOS API is unavailable.');
    expect(describeError(new Error('secret details'), 'fallback')).toBe('fallback');
    component.ngOnDestroy();
  });
});
