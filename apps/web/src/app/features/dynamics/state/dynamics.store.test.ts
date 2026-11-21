import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DynamicsStore } from './dynamics.store';
import { DynamicsApiService } from '../data-access/dynamics-api.service';
import type { DynamicsHistoryResponse } from '../model/dynamics.models';
import { localCalendarDate } from '../../../shared/util/analytics-query-state';

const fixture = { range: { from: '2016-01-01', to: localCalendarDate() }, dates: ['2016-01-01'] } as DynamicsHistoryResponse;
function create(api: object) {
  const injector = Injector.create({ providers: [{ provide: DynamicsApiService, useValue: api }] });
  return runInInjectionContext(injector, () => new DynamicsStore());
}
describe('route scoped Dynamics history', () => {
  it('loads once for range, metric and window changes and explicitly refreshes current records', () => {
    const api = { history: vi.fn().mockReturnValue(of(fixture)) };
    const store = create(api); store.load(); store.load(); store.load();
    expect(api.history).toHaveBeenCalledTimes(1);
    store.load(true); expect(api.history).toHaveBeenCalledTimes(2);
    expect(store.state()).toBe('loaded'); store.ngOnDestroy(); expect(store.history()).toBeNull();
  });
  it('cancels replacement and teardown, ignores late data, and clears private data on errors', () => {
    const first = new Subject<DynamicsHistoryResponse>(), second = new Subject<DynamicsHistoryResponse>();
    const api = { history: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const store = create(api); store.load(); store.load(true);
    expect(first.observed).toBe(false); first.next(fixture); expect(store.history()).toBeNull();
    second.error(new Error('private transport content')); expect(store.state()).toBe('error');
    expect(store.errorMessage()).not.toContain('private'); store.ngOnDestroy(); expect(second.observed).toBe(false);
  });
});
