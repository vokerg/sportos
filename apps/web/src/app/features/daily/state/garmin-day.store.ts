import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { GarminDayApiService } from '../data-access/garmin-day-api.service';
import type { GarminDay, GarminDayCategory } from '../model/garmin-day.models';
@Injectable()
export class GarminDayStore implements OnDestroy {
  readonly data = signal<GarminDay | null>(null);
  readonly loading = signal(false); readonly fetching = signal(false); readonly error = signal('');
  readonly expanded = signal(false); readonly resourceLoading = signal(false);
  readonly resourceJson = signal<string | null>(null); readonly resourceError = signal('');
  private date = ''; private generation = 0; private request?: Subscription; private resourceRequest?: Subscription;
  constructor(private readonly api: GarminDayApiService) {}
  ngOnDestroy() { this.cancel(); }
  private cancel() { this.generation++; this.request?.unsubscribe(); this.resourceRequest?.unsubscribe(); }
  load(date: string) {
    this.cancel(); this.date = date; this.data.set(null); this.loading.set(true); this.fetching.set(false);
    this.error.set(''); this.expanded.set(false); this.resourceJson.set(null); this.resourceError.set(''); this.resourceLoading.set(false);
    const generation = this.generation;
    this.request = this.api.read(date).subscribe({ next: data => { if (generation === this.generation) { this.data.set(data); this.loading.set(false); } },
      error: () => { if (generation === this.generation) { this.loading.set(false); this.error.set('Could not read retained Garmin day evidence. Retry loading.'); } } });
  }
  view() { this.expanded.set(!this.expanded()); }
  fetch(refresh = false) {
    if (!this.date || this.fetching() || this.loading() || !this.data()?.fetchEnabled) return;
    this.request?.unsubscribe(); this.fetching.set(true); this.error.set(''); const generation = this.generation;
    this.request = this.api.fetch(this.date, refresh).subscribe({ next: data => {
      if (generation !== this.generation) return;
      this.data.set(data); this.fetching.set(false); this.expanded.set(true); this.resourceJson.set(null);
    }, error: error => { if (generation === this.generation) { this.fetching.set(false); this.error.set(message(error)); } } });
  }
  resource(category: GarminDayCategory) {
    this.resourceRequest?.unsubscribe(); this.resourceLoading.set(true); this.resourceJson.set(null); this.resourceError.set(''); const generation = this.generation;
    this.resourceRequest = this.api.resource(this.date, category).subscribe({ next: data => {
      if (generation === this.generation) { this.resourceJson.set(JSON.stringify(data.payload, null, 2)); this.resourceLoading.set(false); }
    }, error: () => { if (generation === this.generation) { this.resourceError.set('Retained resource could not be read. Retry later.'); this.resourceLoading.set(false); } } });
  }
}
function message(error: unknown): string {
  if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') return error.error.message.slice(0,300);
  return 'Garmin fetch failed or timed out. Prior retained evidence is safe; retry after checking the local login.';
}
