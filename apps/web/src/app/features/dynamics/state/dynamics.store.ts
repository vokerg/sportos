import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { DynamicsApiService } from '../data-access/dynamics-api.service';
import type { DynamicsHistoryResponse } from '../model/dynamics.models';
import { localCalendarDate } from '../../../shared/util/analytics-query-state';

@Injectable()
export class DynamicsStore implements OnDestroy {
  private readonly api = inject(DynamicsApiService);
  readonly history = signal<DynamicsHistoryResponse | null>(null);
  readonly state = signal<'loading' | 'loaded' | 'empty' | 'error'>('loading');
  readonly errorMessage = signal<string | null>(null);
  private request?: Subscription;
  private generation = 0;

  load(force = false): void {
    if (!force && this.history()?.range.to === localCalendarDate()) { this.state.set(this.history()!.dates.length ? 'loaded' : 'empty'); this.errorMessage.set(null); return; }
    if (!force && this.request && !this.request.closed) return;
    this.request?.unsubscribe();
    const generation = ++this.generation;
    this.state.set('loading'); this.errorMessage.set(null); this.history.set(null);
    this.request = this.api.history(localCalendarDate()).subscribe({
      next: (history) => {
        if (generation !== this.generation) return;
        this.history.set(history); this.state.set(history.dates.length ? 'loaded' : 'empty');
      },
      error: () => {
        if (generation !== this.generation) return;
        this.state.set('error'); this.errorMessage.set('Dynamics could not be loaded. Retry to read current canonical history.');
      },
    });
  }
  ngOnDestroy(): void { ++this.generation; this.request?.unsubscribe(); this.history.set(null); }
}
