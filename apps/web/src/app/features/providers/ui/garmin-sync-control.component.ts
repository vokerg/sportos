import { Component, inject, input, OnInit, output } from '@angular/core';
import { GarminSyncStore } from '../state/garmin-sync.store';

@Component({
  selector: 'sportos-garmin-sync-control',
  standalone: true,
  providers: [GarminSyncStore],
  template: `
    <div class="garmin-controls" aria-label="Garmin sync">
      @if (!store.active()) {
        <button type="button" class="garmin-sync-button" (click)="store.sync()"
          [disabled]="store.loading() || store.working() || !store.connection()?.enabled">
          {{ store.loading() ? 'Checking Garmin…' : store.working() ? 'Starting Garmin…' : 'Sync Garmin' }}
        </button>
      }
      @if (store.connection(); as connection) {
        @if (!connection.enabled && !store.active()) {
          <small>{{ connection.reason === 'worker_offline' ? 'Garmin worker is offline.' : connection.reason === 'reauthorization_required' ? 'Garmin needs reconnecting.' : 'Garmin is not connected.' }}</small>
        }
        @if (detailed() && connection.cursor; as cursor) {
          <small>Garmin cursor: {{ cursor.date }} · {{ timestamp(cursor.at, connection.timeZone) }}</small>
        }
      }
      @if (store.job(); as job) {
        <div class="garmin-progress">
          <span role="status">
            @if (store.active() && job.phase !== 'rate_limited') {
              {{ job.status === 'queued' ? 'Garmin sync queued' : 'Syncing Garmin…' }}
              @if (job.operation === 'sync' && (job.processedDays ?? 0) > 0) {
                {{ job.processedDays }} of {{ job.totalDays }} days
              }
            } @else if (job.status === 'succeeded' && !detailed()) {
              Garmin sync complete
            } @else {
              {{ store.message() }}
            }
          </span>
          @if (store.active() && job.operation === 'sync' && job.phase !== 'rate_limited') {
            @if ((job.processedDays ?? 0) > 0) {
              <progress aria-label="Garmin sync progress" [max]="job.totalDays ?? 1"
                [value]="job.processedDays"></progress>
            } @else if (job.status === 'running') {
              <progress aria-label="Garmin sync in progress"></progress>
            }
          }
          @if (store.active() && detailed()) {
            <button type="button" class="secondary" [disabled]="store.working()"
              (click)="store.cancel()">Cancel Garmin sync</button>
          }
          @if (job.status === 'failed' || (job.status === 'cancelled' && detailed())) {
            <button type="button" [disabled]="store.working() || !store.connection()?.enabled"
              (click)="store.retry()">Retry Garmin sync</button>
          }
        </div>
      }
      @if (store.error()) {
        <span role="alert">{{ store.error() }}</span>
        <button type="button" class="secondary" (click)="store.refreshStatus()">Check status</button>
      }
      @if (detailed()) {
        <p>Refresh from the cursor day through today, including final steps and late uploads. Repeating sync today is supported. Fetching a newer day advances the cursor; re-fetching an already covered day leaves it unchanged. Scores change only with Recalculate.</p>
      }
    </div>`,
  styles: [`
    :host { display: block; }
    .garmin-controls, .garmin-progress { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .garmin-sync-button { background: var(--primary); color: var(--on-primary); padding: 10px 14px; border-radius: 11px; white-space: nowrap; }
    .garmin-controls small { color: var(--text-muted); font-size: 11px; }
    progress { width: 130px; }
    p { color: var(--text-muted); font-size: 13px; }
  `],
})
export class GarminSyncControlComponent implements OnInit {
  readonly detailed = input(false);
  readonly synced = output<void>();

  readonly store = inject(GarminSyncStore);

  timestamp(value: string, timeZone: string) {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short', timeZone }).format(new Date(value));
    } catch {
      return value;
    }
  }

  ngOnInit() {
    this.store.initialize(() => this.synced.emit());
  }
}
