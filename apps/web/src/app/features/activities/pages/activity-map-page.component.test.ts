import '@angular/compiler';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { ActivityMapPageComponent } from './activity-map-page.component';
import { ActivityDetailStore } from '../state/activity-detail.store';
import { APP_ROUTES } from '../../../app.routes';

it('lazy-loads a full-page route before the activity detail route', async () => {
  const index = APP_ROUTES.findIndex(route => route.path === 'activity/:id/map');
  expect(index).toBeLessThan(APP_ROUTES.findIndex(route => route.path === 'activity/:id'));
  expect(APP_ROUTES[index].data).toEqual({ fullPage: true });
  expect(await (APP_ROUTES[index].loadComponent as () => Promise<unknown>)()).toBe(ActivityMapPageComponent);
});

describe('ActivityMapPageComponent', () => {
  it('loads retained route only and cancels on route replacement and teardown', () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'one' }));
    const first = new Subject<never>();
    const second = new Subject<never>();
    const api = {
      detail: vi.fn((id: string) => of({ id })),
      map: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
      enrichment: vi.fn(), fetchProviderDetail: vi.fn(), fetchGarminDetail: vi.fn(),
    };
    const store = new ActivityDetailStore(api as never);
    const page = new ActivityMapPageComponent(store, { paramMap: params } as never);
    page.ngOnInit();
    expect(page.id).toBe('one');
    expect(store.mapState()).toBe('loading');
    expect(api.map).toHaveBeenCalledWith('one');
    params.next(convertToParamMap({ id: 'two' }));
    expect(first.observed).toBe(false);
    expect(page.id).toBe('two');
    expect(store.activity()?.id).toBe('two');
    page.ngOnDestroy();
    expect(second.observed).toBe(false);
    params.next(convertToParamMap({ id: 'three' }));
    expect(api.detail).toHaveBeenCalledTimes(2);
    for (const method of [api.enrichment, api.fetchProviderDetail, api.fetchGarminDetail]) expect(method).not.toHaveBeenCalled();
  });
});
