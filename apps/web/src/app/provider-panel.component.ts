import { Component, OnInit } from '@angular/core';
import { formatDateTime } from './date-time';
import { ProviderStore } from './features/providers/state/provider.store';

@Component({
  selector: 'sportos-provider-panel',
  standalone: true,
  providers: [ProviderStore],
  template: `
    <section class="card" aria-labelledby="providers-title">
      <h2 id="providers-title">Connected providers</h2>
      <p class="help">Connect Strava to retain raw provider provenance, run restart-safe backfills or incremental syncs, and review warnings without exposing provider credentials.</p>

      @if (store.state() === 'loading') {
        <p role="status">Loading provider connections…</p>
      } @else if (store.state() === 'error') {
        <p class="state-message error" role="alert">{{ store.errorMessage() }}</p>
        <button type="button" class="secondary" (click)="store.load()">Retry</button>
      } @else if (!store.connection()) {
        <p>No provider is connected.</p>
        <button type="button" (click)="connect()" [disabled]="store.state() === 'working'">Connect Strava</button>
      } @else {
        <div class="provider-summary">
          <div><strong>Strava</strong><span>{{ store.connection()!.displayName || 'Connected athlete' }}</span></div>
          <span class="status" [attr.data-status]="store.connection()!.status">{{ store.connection()!.status }}</span>
        </div>
        <p class="meta">Scopes: {{ store.connection()!.scopes.join(', ') || 'none' }}</p>
        <p class="meta">Last successful sync: {{ formatTimestamp(store.connection()!.lastSyncAt) }}</p>
        @if (store.connection()!.error) { <p class="state-message error" role="alert">{{ store.connection()!.error!.message }}</p> }

        <div class="actions">
          @if (store.connection()!.status === 'connected') {
            <button type="button" (click)="store.sync('incremental')" [disabled]="store.busy()">Sync changes</button>
            <button type="button" class="secondary" (click)="store.sync('initial_backfill')" [disabled]="store.busy()">Backfill history</button>
          } @else {
            <button type="button" (click)="connect()" [disabled]="store.busy()">Reconnect Strava</button>
          }
          <button type="button" class="secondary" (click)="store.disconnect()" [disabled]="store.state() === 'working'">Disconnect</button>
        </div>

        @if (store.job()) {
          <div class="job" aria-live="polite">
            <div class="job-heading"><strong>{{ store.job()!.mode === 'initial_backfill' ? 'Backfill' : 'Sync' }}</strong><span>{{ store.job()!.status }} · {{ store.job()!.phase }}</span></div>
            <progress max="100" [value]="store.job()!.progressPercent">{{ store.job()!.progressPercent }}%</progress>
            <p class="meta">Attempt {{ store.job()!.attemptCount }} of {{ store.job()!.maxAttempts }}</p>
            @if (store.job()!.batchId) { <p class="meta">Provenance batch: <code>{{ store.job()!.batchId }}</code></p> }
            @if (store.job()!.error) { <p class="state-message error" role="alert">{{ store.job()!.error!.message }}</p> }
            @if (store.pollingPaused()) { <p class="state-message" role="status">Automatic status refresh paused after ten minutes. Refresh this panel to continue checking.</p> }
            <div class="actions">
              @if (store.job()!.status === 'queued' || store.job()!.status === 'running') { <button type="button" class="secondary" (click)="store.cancel()">Cancel</button> }
              @else if (store.job()!.status === 'failed' && store.job()!.attemptCount < store.job()!.maxAttempts) { <button type="button" (click)="store.retry()">Retry</button> }
              @if (store.pollingPaused()) { <button type="button" class="secondary" (click)="store.refreshJob()">Refresh status</button> }
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
export class ProviderPanelComponent implements OnInit {
  constructor(readonly store: ProviderStore) {}

  ngOnInit(): void {
    this.store.initialize();
  }

  connect(): void {
    this.store.connect((authorizationUrl) => window.location.assign(authorizationUrl));
  }

  formatTimestamp(value: string | null): string {
    return formatDateTime(value, 'not yet synced');
  }
}

export { describeProviderError as describeError } from './features/providers/data-access/provider-errors';
