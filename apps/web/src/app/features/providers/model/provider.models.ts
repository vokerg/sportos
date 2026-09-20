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

export function describeProviderError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;

  const candidate = error as {
    status?: unknown;
    error?: unknown;
  };
  if (candidate.status === 0) return 'The SportOS API is unavailable.';

  const body = candidate.error && typeof candidate.error === 'object'
    ? candidate.error as { message?: unknown }
    : null;
  return typeof body?.message === 'string' && body.message.length > 0
    ? body.message
    : fallback;
}
