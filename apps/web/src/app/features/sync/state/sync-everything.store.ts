import { Injectable, OnDestroy, signal } from '@angular/core';
import { defer, firstValueFrom, fromEvent, filter, takeUntil, tap } from 'rxjs';
import { pollDurableJob } from '../../../core/jobs/durable-job-poller';
import { SyncEverything, activeSyncJob, syncButtonLabel, type SyncView } from '../../../../../../../packages/shared/src/sync-everything';
import { SyncEverythingApiService } from '../data-access/sync-everything-api.service';

@Injectable()
export class SyncEverythingStore implements OnDestroy {
  private readonly workflow = new SyncEverything();
  private readonly controller = new AbortController();
  readonly view = signal<SyncView>(this.workflow.view);
  readonly busy = signal(false);
  label(): string { return syncButtonLabel(this.view()); }
  constructor(private readonly api: SyncEverythingApiService) {}
  ngOnDestroy(): void { this.controller.abort(); }
  async start(): Promise<boolean> {
    if (this.busy() || this.controller.signal.aborted) return false;
    this.busy.set(true);
    const signal = this.controller.signal;
    try {
      return await this.workflow.run({
        signal,
        read: path => this.api.read(path, signal),
        post: (path, body) => this.api.post(path, body, signal),
        watch: async (initial, read, report) => {
          if (!activeSyncJob(initial)) return initial;
          const result = await firstValueFrom(pollDurableJob(() => defer(read), {
            intervalMs: 2500, maxAttempts: 240, maxDurationMs: 10 * 60 * 1000,
            isTerminal: job => !activeSyncJob(job),
          }).pipe(
            tap(state => { if (state.job) report(state.job); }),
            filter(state => state.state !== 'loading'),
            takeUntil(fromEvent(signal, 'abort')),
          ));
          if (result.state === 'error') throw new Error('Status unavailable');
          return result.state === 'terminal' ? result.job : null;
        },
      }, view => this.view.set(view));
    } finally { if (!signal.aborted) this.busy.set(false); }
  }
}
