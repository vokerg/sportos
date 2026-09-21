import { computed, Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { pollDurableJob } from '../../../core/jobs/durable-job-poller';
import { ProviderApiService } from '../data-access/provider-api.service';
import { describeProviderError } from '../data-access/provider-errors';
import {
  isActiveProviderJob,
  isTerminalProviderJob,
  type ProviderConnection,
  type ProviderPanelState,
  type ProviderSyncJob,
} from '../model/provider.models';

const PROVIDER_POLL_INTERVAL_MS = 1_500;
const PROVIDER_POLL_MAX_ATTEMPTS = 400;
const PROVIDER_POLL_MAX_DURATION_MS = 10 * 60 * 1_000;

@Injectable()
export class ProviderStore implements OnDestroy {
  readonly state = signal<ProviderPanelState>('loading');
  readonly connections = signal<ProviderConnection[]>([]);
  readonly connection = signal<ProviderConnection | null>(null);
  readonly job = signal<ProviderSyncJob | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly pollingPaused = signal(false);
  readonly busy = computed(() => this.state() === 'working' || isActiveProviderJob(this.job()));

  private initialized = false;
  private connectionSubscription?: Subscription;
  private recoverySubscription?: Subscription;
  private actionSubscription?: Subscription;
  private jobPollingSubscription?: Subscription;
  private terminalRefreshSubscription?: Subscription;

  constructor(private readonly api: ProviderApiService) {}

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.load();
  }

  ngOnDestroy(): void {
    this.connectionSubscription?.unsubscribe();
    this.recoverySubscription?.unsubscribe();
    this.actionSubscription?.unsubscribe();
    this.stopJobPolling();
    this.stopTerminalRefresh();
  }

  load(): void {
    this.stopJobPolling();
    this.stopTerminalRefresh();
    this.pollingPaused.set(false);
    this.state.set('loading');
    this.errorMessage.set(null);
    this.job.set(null);
    this.connectionSubscription?.unsubscribe();
    this.recoverySubscription?.unsubscribe();
    this.actionSubscription?.unsubscribe();

    this.connectionSubscription = this.api.connections().subscribe({
      next: (connections) => {
        const connection = this.setConnections(connections);
        this.state.set('ready');
        if (connection) this.recoverLatestJob(connection.id);
      },
      error: (error: unknown) => this.fail(error, 'Provider connections could not be loaded.'),
    });
  }

  connect(redirect: (authorizationUrl: string) => void): void {
    this.stopTerminalRefresh();
    this.state.set('working');
    this.errorMessage.set(null);
    this.actionSubscription?.unsubscribe();
    this.actionSubscription = this.api.startStrava('/providers').subscribe({
      next: ({ authorizationUrl }) => redirect(authorizationUrl),
      error: (error: unknown) => this.fail(error, 'Strava connection could not be started.'),
    });
  }

  sync(mode: 'initial_backfill' | 'incremental'): void {
    const connection = this.connection();
    if (!connection) return;

    this.stopTerminalRefresh();
    this.state.set('working');
    this.errorMessage.set(null);
    this.pollingPaused.set(false);
    this.actionSubscription?.unsubscribe();
    this.actionSubscription = this.api.enqueueSync(connection.id, mode).subscribe({
      next: (job) => {
        this.job.set(job);
        this.state.set('ready');
        if (isTerminalProviderJob(job)) this.handleTerminalJob(job);
        else this.monitorJob(job.id);
      },
      error: (error: unknown) => this.fail(error, 'Provider sync could not be queued.'),
    });
  }

  retry(): void {
    const job = this.job();
    if (!job || job.status !== 'failed') return;

    this.stopTerminalRefresh();
    this.state.set('working');
    this.errorMessage.set(null);
    this.pollingPaused.set(false);
    this.actionSubscription?.unsubscribe();
    this.actionSubscription = this.api.retrySync(job.id).subscribe({
      next: (updated) => {
        this.job.set(updated);
        this.state.set('ready');
        if (isTerminalProviderJob(updated)) this.handleTerminalJob(updated);
        else this.monitorJob(updated.id);
      },
      error: (error: unknown) => this.fail(error, 'Provider sync could not be retried.'),
    });
  }

  cancel(): void {
    const job = this.job();
    if (!job || !isActiveProviderJob(job)) return;

    this.stopTerminalRefresh();
    this.actionSubscription?.unsubscribe();
    this.actionSubscription = this.api.cancelSync(job.id).subscribe({
      next: (updated) => {
        this.job.set(updated);
        if (isTerminalProviderJob(updated)) this.handleTerminalJob(updated);
        else this.monitorJob(updated.id);
      },
      error: (error: unknown) => this.fail(error, 'Provider sync could not be cancelled.'),
    });
  }

  refreshJob(): void {
    const job = this.job();
    if (!job) return;
    this.pollingPaused.set(false);
    this.errorMessage.set(null);
    this.monitorJob(job.id);
  }

  disconnect(): void {
    const connection = this.connection();
    if (!connection) return;

    this.stopJobPolling();
    this.stopTerminalRefresh();
    this.state.set('working');
    this.errorMessage.set(null);
    this.recoverySubscription?.unsubscribe();
    this.actionSubscription?.unsubscribe();
    this.actionSubscription = this.api.disconnect(connection.id).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.fail(error, 'Provider connection could not be disconnected.'),
    });
  }

  private recoverLatestJob(connectionId: string): void {
    this.recoverySubscription?.unsubscribe();
    this.recoverySubscription = this.api.syncJobs(connectionId, 1).subscribe({
      next: (jobs) => {
        const latest = jobs[0] ?? null;
        this.job.set(latest);
        if (isActiveProviderJob(latest)) this.monitorJob(latest.id);
      },
      error: () => this.job.set(null),
    });
  }

  private monitorJob(jobId: string): void {
    this.stopJobPolling();
    this.jobPollingSubscription = pollDurableJob(
      () => this.api.syncJob(jobId),
      {
        intervalMs: PROVIDER_POLL_INTERVAL_MS,
        maxAttempts: PROVIDER_POLL_MAX_ATTEMPTS,
        maxDurationMs: PROVIDER_POLL_MAX_DURATION_MS,
        isTerminal: isTerminalProviderJob,
      },
    ).subscribe({
      next: (pollState) => {
        if (pollState.state === 'loading') {
          this.job.set(pollState.job);
          return;
        }

        if (pollState.state === 'terminal') {
          this.job.set(pollState.job);
          this.handleTerminalJob(pollState.job);
          return;
        }

        if (pollState.state === 'error') {
          this.fail(pollState.error, 'Provider sync status could not be refreshed.');
          return;
        }

        if (pollState.job) this.job.set(pollState.job);
        this.pollingPaused.set(true);
        this.state.set('ready');
      },
    });
  }

  private handleTerminalJob(job: ProviderSyncJob): void {
    this.stopJobPolling();
    this.pollingPaused.set(false);
    this.job.set(job);
    this.state.set('ready');
    this.refreshConnectionAfterTerminal();
  }

  private refreshConnectionAfterTerminal(): void {
    this.stopTerminalRefresh();
    this.terminalRefreshSubscription = this.api.connections().subscribe({
      next: (connections) => this.setConnections(connections),
    });
  }

  private setConnections(connections: ProviderConnection[]): ProviderConnection | null {
    const connection = connections.find((item) => item.provider === 'strava') ?? null;
    this.connections.set(connections);
    this.connection.set(connection);
    return connection;
  }

  private stopJobPolling(): void {
    this.jobPollingSubscription?.unsubscribe();
    this.jobPollingSubscription = undefined;
  }

  private stopTerminalRefresh(): void {
    this.terminalRefreshSubscription?.unsubscribe();
    this.terminalRefreshSubscription = undefined;
  }

  private fail(error: unknown, fallback: string): void {
    this.stopJobPolling();
    this.stopTerminalRefresh();
    this.errorMessage.set(describeProviderError(error, fallback));
    this.state.set('error');
  }
}
