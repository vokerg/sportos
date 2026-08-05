import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { ProvidersController } from './providers.controller.js';
import type { ProvidersService } from './providers.service.js';

const account = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Provider User',
  email: null,
} as AuthenticatedAccount;
const connectionId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const connection = {
  id: connectionId,
  provider: 'strava' as const,
  displayName: 'Athlete',
  scopes: ['activity:read_all'],
  status: 'connected' as const,
  accessExpiresAt: '2026-08-04T20:00:00.000Z',
  lastSyncAt: null,
  lastAttemptAt: null,
  error: null,
  createdAt: '2026-08-04T18:00:00.000Z',
  updatedAt: '2026-08-04T18:00:00.000Z',
  disconnectedAt: null,
  revokedAt: null,
};
const job = {
  id: jobId,
  connectionId,
  mode: 'incremental' as const,
  batchId: null,
  status: 'queued' as const,
  phase: 'queued',
  progressPercent: 0,
  attemptCount: 0,
  maxAttempts: 5,
  cancellationRequested: false,
  requestedAfter: null,
  requestedBefore: '2026-08-04T19:00:00.000Z',
  error: null,
  result: {},
  createdAt: '2026-08-04T19:00:00.000Z',
  updatedAt: '2026-08-04T19:00:00.000Z',
  startedAt: null,
  completedAt: null,
};

describe('ProvidersController', () => {
  let service: {
    listConnections: ReturnType<typeof vi.fn>;
    startStrava: ReturnType<typeof vi.fn>;
    completeStrava: ReturnType<typeof vi.fn>;
    enqueueSync: ReturnType<typeof vi.fn>;
    listSyncJobs: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    getSyncJob: ReturnType<typeof vi.fn>;
    retrySync: ReturnType<typeof vi.fn>;
    cancelSync: ReturnType<typeof vi.fn>;
  };
  let controller: ProvidersController;

  beforeEach(() => {
    service = {
      listConnections: vi.fn(),
      startStrava: vi.fn(),
      completeStrava: vi.fn(),
      enqueueSync: vi.fn(),
      listSyncJobs: vi.fn(),
      disconnect: vi.fn(),
      getSyncJob: vi.fn(),
      retrySync: vi.fn(),
      cancelSync: vi.fn(),
    };
    controller = new ProvidersController(service as unknown as ProvidersService);
  });

  it('derives connection and sync ownership from the authenticated account', async () => {
    service.listConnections.mockResolvedValue([connection]);
    service.startStrava.mockResolvedValue({ authorizationUrl: 'https://www.strava.com/oauth/authorize' });
    service.enqueueSync.mockResolvedValue(job);
    service.listSyncJobs.mockResolvedValue([job]);
    service.getSyncJob.mockResolvedValue(job);
    service.retrySync.mockResolvedValue(job);
    service.cancelSync.mockResolvedValue({ ...job, status: 'cancelled' });
    service.disconnect.mockResolvedValue({ disconnected: true });

    await expect(controller.connections(account)).resolves.toEqual([connection]);
    await expect(controller.startStrava({ returnTo: '/#providers' }, account)).resolves.toMatchObject({ authorizationUrl: expect.any(String) });
    await expect(controller.enqueueSync(connectionId, { mode: 'incremental' }, account)).resolves.toEqual(job);
    await expect(controller.listJobs(connectionId, '1', account)).resolves.toEqual([job]);
    await expect(controller.job(jobId, account)).resolves.toEqual(job);
    await expect(controller.retry(jobId, account)).resolves.toEqual(job);
    await expect(controller.cancel(jobId, account)).resolves.toMatchObject({ status: 'cancelled' });
    await expect(controller.disconnect(connectionId, account)).resolves.toEqual({ disconnected: true });

    expect(service.listConnections).toHaveBeenCalledWith(account.id);
    expect(service.startStrava).toHaveBeenCalledWith(account.id, '/#providers');
    expect(service.enqueueSync).toHaveBeenCalledWith(account.id, connectionId, { mode: 'incremental' });
    expect(service.listSyncJobs).toHaveBeenCalledWith(account.id, connectionId, 1);
    expect(service.getSyncJob).toHaveBeenCalledWith(account.id, jobId);
    expect(service.retrySync).toHaveBeenCalledWith(account.id, jobId);
    expect(service.cancelSync).toHaveBeenCalledWith(account.id, jobId);
    expect(service.disconnect).toHaveBeenCalledWith(account.id, connectionId);
  });

  it('validates connection/job UUIDs and pagination before service calls', async () => {
    const operations: Array<() => unknown> = [
      () => controller.enqueueSync('not-a-uuid', {}, account),
      () => controller.listJobs('not-a-uuid', undefined, account),
      () => controller.disconnect('not-a-uuid', account),
      () => controller.job('not-a-uuid', account),
      () => controller.retry('not-a-uuid', account),
      () => controller.cancel('not-a-uuid', account),
      () => controller.listJobs(connectionId, '0', account),
      () => controller.listJobs(connectionId, '101', account),
      () => controller.listJobs(connectionId, '1.5', account),
    ];

    for (const operation of operations) {
      await expect(Promise.resolve().then(() => operation())).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(service.enqueueSync).not.toHaveBeenCalled();
    expect(service.listSyncJobs).not.toHaveBeenCalled();
    expect(service.disconnect).not.toHaveBeenCalled();
    expect(service.getSyncJob).not.toHaveBeenCalled();
    expect(service.retrySync).not.toHaveBeenCalled();
    expect(service.cancelSync).not.toHaveBeenCalled();
  });

  it('completes callbacks under the current account and redirects only to the configured web origin', async () => {
    service.completeStrava.mockResolvedValue({ connection, returnTo: '/#providers' });
    const redirect = vi.fn();
    const previousOrigin = process.env.SPORTOS_WEB_ORIGIN;
    process.env.SPORTOS_WEB_ORIGIN = 'https://sportos.example';
    try {
      await controller.completeStrava('state', 'code', 'read,activity:read_all', undefined, account, { redirect });
    } finally {
      process.env.SPORTOS_WEB_ORIGIN = previousOrigin;
    }
    expect(service.completeStrava).toHaveBeenCalledWith(account.id, {
      state: 'state',
      code: 'code',
      scope: 'read,activity:read_all',
      providerError: undefined,
    });
    expect(redirect).toHaveBeenCalledWith(303, 'https://sportos.example/#providers');
  });
});
