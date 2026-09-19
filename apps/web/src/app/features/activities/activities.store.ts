import { Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ActivitiesApiService, type ActivitiesQuery, type ActivitiesResponse } from './activities-api.service';

@Injectable()
export class ActivitiesStore {
  readonly state = signal<'loading' | 'loaded' | 'error'>('loading');
  readonly result = signal<ActivitiesResponse | null>(null);
  private request?: Subscription;

  constructor(private readonly api: ActivitiesApiService) {}

  load(query: ActivitiesQuery): void {
    this.request?.unsubscribe();
    this.state.set('loading');
    this.result.set(null);
    this.request = this.api.list(query).subscribe({
      next: (result) => { this.result.set(result); this.state.set('loaded'); },
      error: () => this.state.set('error'),
    });
  }

  destroy(): void { this.request?.unsubscribe(); }
}
