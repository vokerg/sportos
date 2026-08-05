import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ApiService } from './api.service';

export type ProviderConnectionStatus = 'connected' | 'reauthorization_required' | 'revoked' | 'disconnected' | 'error';
export type ProviderSyncStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ProviderConnection {
  id: string;
  provider: 'strava';
  displayName: string | null;
  scopes: string[];
  status: ProviderConnectionStatus;
  accessExpiresAt: string | null;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
  revokedAt: string | null;
}

export interface ProviderSyncJob {
  id: string;
  connectionId: string;
  mode: 'initial_backfill' | 'incremental' | 'webhook_refresh';
  batchId: string | null;
  status: ProviderSyncStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  requestedAfter: string | null;
  requestedBefore: string | null;
  error: { code: string; message: string } | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProviderApiService {
  constructor(private readonly http: HttpClient, private readonly api: ApiService) {}

  connections() {
    return this.http.get<ProviderConnection[]>(`${this.api.apiBase()}/providers/connections`);
  }

  startStrava(returnTo = '/') {
    return this.http.post<{ authorizationUrl: string }>(`${this.api.apiBase()}/providers/strava/connect`, { returnTo });
  }

  enqueueSync(connectionId: string, mode: 'initial_backfill' | 'incremental') {
    return this.http.post<ProviderSyncJob>(
      `${this.api.apiBase()}/providers/connections/${encodeURIComponent(connectionId)}/sync`,
      { mode },
    );
  }

  syncJobs(connectionId: string, limit = 20) {
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    return this.http.get<ProviderSyncJob[]>(
      `${this.api.apiBase()}/providers/connections/${encodeURIComponent(connectionId)}/jobs?limit=${boundedLimit}`,
    );
  }

  syncJob(jobId: string) {
    return this.http.get<ProviderSyncJob>(`${this.api.apiBase()}/providers/jobs/${encodeURIComponent(jobId)}`);
  }

  retrySync(jobId: string) {
    return this.http.post<ProviderSyncJob>(`${this.api.apiBase()}/providers/jobs/${encodeURIComponent(jobId)}/retry`, {});
  }

  cancelSync(jobId: string) {
    return this.http.post<ProviderSyncJob>(`${this.api.apiBase()}/providers/jobs/${encodeURIComponent(jobId)}/cancel`, {});
  }

  disconnect(connectionId: string) {
    return this.http.post<{ disconnected: true }>(
      `${this.api.apiBase()}/providers/connections/${encodeURIComponent(connectionId)}/disconnect`,
      {},
    );
  }
}
