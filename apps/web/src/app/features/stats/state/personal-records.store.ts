import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { localCalendarDate } from '../../../shared/util/analytics-query-state';
import { PersonalRecordsApiService } from '../data-access/personal-records-api.service';
import type { PersonalRecordsResponse } from '../model/personal-records.models';

@Injectable()
export class PersonalRecordsStore {
  private readonly api = inject(PersonalRecordsApiService);
  private readonly destroyRef = inject(DestroyRef);
  readonly data = signal<PersonalRecordsResponse | null>(null);
  readonly state = signal<'loading' | 'loaded' | 'error'>('loading');

  load(): void {
    this.state.set('loading');
    this.api.read(localCalendarDate()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.data.set(data);
        this.state.set('loaded');
      },
      error: () => this.state.set('error'),
    });
  }
}
