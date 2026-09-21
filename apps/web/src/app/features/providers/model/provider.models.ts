export type ProviderConnectionStatus =
  | 'connected'
  | 'reauthorization_required'
  | 'revoked'
  | 'disconnected'
  | 'error';

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

export type ProviderPanelState = 'loading' | 'ready' | 'working' | 'error';

export function isActiveProviderJob(job: ProviderSyncJob | null): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

export function isTerminalProviderJob(job: ProviderSyncJob): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
}

