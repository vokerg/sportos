import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ProviderApiService, type ProviderConnection, type ProviderSyncJob } from './provider-api.service';

type PanelState = 'loading' | 'ready' | 'working' | 'error';

@Component({
  selector: 'sportos-provider-panel',
  standalone: true,
  template: `
    <section class="card" aria-labelledby="providers-title">
      <h2 id="providers-title">Connected providers</h2>
      <p class="help">Connect Strava to retain raw provider provenance, run restart-safe backfills or incremental syncs, and review warnings without exposing provider credentials.</p>

      @if (state() === 'loading') {
        <p role="status">Loading provider connections…</p>
      } @else if (state() === 'error') {
        <p class="state-message error" role="alert">{{ errorMessage() }}</p>
        <button type="button" class="secondary" (click)="load()">Retry</button>
      } @else if (!connection()) {
        <p>No provider is connected.</p>
        <button type="button" (click)="connect()" [disabled]="state() === 'working'">Connect Strava</button>
      } @else {
        <div class="provider-summary">
          <div><strong>Strava</strong><span>{{ connection()!.displayName || 'Connected athlete' }}</span></div>
          <span class="status" [attr.data-status]="connection()!.status">{{ connection()!.status }}</span>
        </div>
        <p class="meta">Scopes: {{ connection()!.scopes.join(', ') || 'none' }}</p>
        <p class="meta">Last successful sync: {{ connection()!.lastSyncAt || 'not yet synced' }}</p>
        @if (connection()!.error) { <p class="state-message error" role="alert">{{ connection()!.error!.message }}</p> }

        <div class="actions">
          @if (connection()!.status === 'connected') {
            <button type="button" (click)="sync('incremental')" [disabled]="busy()">Sync changes</button>
            <button type="button" class="secondary" (click)="sync('initial_backfill')" [disabled]="busy()">Backfill history</button>
          } @else {
            <button type="button" (click)="connect()" [disabled]="busy()">Reconnect Strava</button>
          }
          <button type="button" class="secondary" (click)="disconnect()" [disabled]="state() === 'working'">Disconnect</button>
        </div>

        @if (job()) {
          <div class="job" aria-live="polite">
            <div class="job-heading"><strong>{{ job()!.mode === 'initial_backfill' ? 'Backfill' : 'Sync' }}</strong><span>{{ job()!.status }} · {{ job()!.phase }}</span></div>
            <progress max="100" [value]="job()!.progressPercent">{{ job()!.progressPercent }}%</progress>
            <p class="meta">Attempt {{ job()!.attemptCount }} of {{ job()!.maxAttempts }}</p>
            @if (job()!.batchId) { <p class="meta">Provenance batch: <code>{{ job()!.batchId }}</code></p> }
            @if (job()!.error) { <p class="state-message error" role="alert">{{ job()!.error!.message }}</p> }
            @if (pollingPaused()) { <p class="state-message" role="status">Automatic status refresh paused after ten minutes. Refresh this panel to continue checking.</p> }
            <div class="actions">
              @if (job()!.status === 'queued' || job()!.status === 'running') { <button type="button" class="secondary" (click)="cancel()">Cancel</button> }
              @else if (job()!.status === 'failed' && job()!.attemptCount < job()!.maxAttempts) { <button type="button" (click)="retry()">Retry</button> }
              @if (pollingPaused()) { <button type="button" class="secondary" (click)="refreshJob()">Refresh status</button> }
            </div>
          </div>
        }
      }
    </section>
  `,
  styles: [`
    .help { margin: -6px 0 16px; color: #667085; font-size: 13px; }
    .provider-summary, .job-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .provider-summary div { display: grid; gap: 2px; }
    .status { text-transform: capitalize; font-size: 12px; font-weight: 700; }
    .meta { color: #667085; font-size: 13px; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .job { margin-top: 18px; padding-top: 16px; border-top: 1px solid #eaecf0; }
    progress { width: 100%; margin-top: 10px; }
  `],
})
export class ProviderPanelComponent implements OnInit, OnDestroy {
  readonly state = signal<PanelState>('loading');
  readonly connections = signal<ProviderConnection[]>([]);
  readonly connection = signal<ProviderConnection | null>(null);
  readonly job = signal<ProviderSyncJob | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly pollingPaused = signal(false);

  private subscription?: Subscription;
  private recoverySubscription?: Subscription;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private pollCount = 0;
  private readonly maxPolls = 400;

  constructor(private readonly api: ProviderApiService) {}
  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.recoverySubscription?.unsubscribe();
    this.clearPolling();
  }

  busy(): boolean {
    const status = this.job()?.status;
    return this.state() === 'working' || status === 'queued' || status === 'running';
  }

  load(): void {
    this.clearPolling();
    this.pollCount = 0;
    this.pollingPaused.set(false);
    this.state.set('loading');
    this.errorMessage.set(null);
    this.job.set(null);
    this.subscription?.unsubscribe();
    this.recoverySubscription?.unsubscribe();
    this.subscription = this.api.connections().subscribe({
      next: (connections) => {
        const connection = connections.find((item) => item.provider === 'strava') ?? null;
        this.connections.set(connections);
        this.connection.set(connection);
        this.state.set('ready');
        if (connection) this.recoverLatestJob(connection.id);
      },
      error: (error: unknown) => this.fail(error, 'Provider connections could not be loaded.'),
    });
  }

  connect(): void {
    this.state.set('working');
    this.subscription?.unsubscribe();
    this.subscription = this.api.startStrava('/#providers').subscribe({
      next: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
      error: (error: unknown) => this.fail(error, 'Strava connection could not be started.'),
    });
  }

  sync(mode: 'initial_backfill' | 'incremental'): void {
    const connection = this.connection();
    if (!connection) return;
    this.beginPolling();
    this.state.set('working');
    this.subscription?.unsubscribe();
    this.subscription = this.api.enqueueSync(connection.id, mode).subscribe({
      next: (job) => { this.job.set(job); this.state.set('ready'); this.schedulePoll(job); },
      error: (error: unknown) => this.fail(error, 'Provider sync could not be queued.'),
    });
  }

  retry(): void {
    const job = this.job();
    if (!job) return;
    this.beginPolling();
    this.state.set('working');
    this.subscription?.unsubscribe();
    this.subscription = this.api.retrySync(job.id).subscribe({
      next: (updated) => { this.job.set(updated); this.state.set('ready'); this.schedulePoll(updated); },
      error: (error: unknown) => this.fail(error, 'Provider sync could not be retried.'),
    });
  }

  cancel(): void {
    const job = this.job();
    if (!job) return;
    this.subscription?.unsubscribe();
    this.subscription = this.api.cancelSync(job.id).subscribe({
      next: (updated) => { this.job.set(updated); this.schedulePoll(updated); },
      error: (error: unknown) => this.fail(error, 'Provider sync could not be cancelled.'),
    });
  }

  refreshJob(): void {
    const job = this.job();
    if (!job) return;
    this.beginPolling();
    this.fetchJob(job.id);
  }

  disconnect(): void {
    const connection = this.connection();
    if (!connection) return;
    this.clearPolling();
    this.state.set('working');
    this.subscription?.unsubscribe();
    this.recoverySubscription?.unsubscribe();
    this.subscription = this.api.disconnect(connection.id).subscribe({
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
        if (latest?.status === 'queued' || latest?.status === 'running') this.schedulePoll(latest);
      },
      error: () => this.job.set(null),
    });
  }

  private beginPolling(): void { this.clearPolling(); this.pollCount = 0; this.pollingPaused.set(false); }

  private schedulePoll(job: ProviderSyncJob): void {
    this.clearPolling();
    if (job.status !== 'queued' && job.status !== 'running') { this.loadConnectionAfterTerminal(); return; }
    if (this.pollCount >= this.maxPolls) { this.pollingPaused.set(true); return; }
    this.pollCount += 1;
    this.pollTimer = setTimeout(() => this.fetchJob(job.id), 1500);
  }

  private fetchJob(jobId: string): void {
    this.subscription?.unsubscribe();
    this.subscription = this.api.syncJob(jobId).subscribe({
      next: (updated) => { this.job.set(updated); this.schedulePoll(updated); },
      error: (error: unknown) => this.fail(error, 'Provider sync status could not be refreshed.'),
    });
  }

  private loadConnectionAfterTerminal(): void {
    this.subscription = this.api.connections().subscribe({
      next: (connections) => {
        this.connections.set(connections);
        this.connection.set(connections.find((item) => item.provider === 'strava') ?? null);
      },
    });
  }

  private clearPolling(): void { if (this.pollTimer) clearTimeout(this.pollTimer); this.pollTimer = undefined; }
  private fail(error: unknown, fallback: string): void { this.clearPolling(); this.errorMessage.set(describeError(error, fallback)); this.state.set('error'); }
}

export function describeError(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  const body = error.error && typeof error.error === 'object' ? error.error as { message?: string } : null;
  if (error.status === 0) return 'The SportOS API is unavailable.';
  return body?.message || fallback;
}
