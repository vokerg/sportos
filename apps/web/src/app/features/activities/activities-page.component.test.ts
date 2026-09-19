import '@angular/compiler';
import { convertToParamMap, type ActivatedRoute, type Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ActivitiesPageComponent } from './activities-page.component';
import { ActivityDetailPageComponent } from './activity-detail-page.component';
import type { ActivitiesApiService, ActivitiesResponse } from './activities-api.service';

const empty: ActivitiesResponse = { items: [], summary: { count: 0, durationS: 0, distanceM: 0 }, limit: 50, offset: 0 };

describe('Activities pages', () => {
  it('loads, shows empty results, and navigates with filters', () => {
    const params = new BehaviorSubject(convertToParamMap({}));
    const api = { list: vi.fn().mockReturnValue(of(empty)) };
    const router = { navigate: vi.fn().mockResolvedValue(true) };
    const page = new ActivitiesPageComponent(api as unknown as ActivitiesApiService, { queryParamMap: params } as unknown as ActivatedRoute, router as unknown as Router);
    expect(page.state()).toBe('loading');
    page.ngOnInit();
    expect(page.state()).toBe('loaded');
    expect(page.result()?.items).toEqual([]);
    page.from.set('2026-01-01'); page.activityType.set('run'); page.source.set('strava');
    page.apply({ preventDefault: vi.fn() } as unknown as Event);
    expect(router.navigate).toHaveBeenCalledWith(['/activities'], { queryParams: expect.objectContaining({ from: '2026-01-01', activityType: 'run', source: 'strava' }) });
    params.next(convertToParamMap({ from: '2026-01-01', activityType: 'run', source: 'strava' }));
    expect(api.list).toHaveBeenLastCalledWith({ from: '2026-01-01', activityType: 'run', source: 'strava', limit: 50, offset: 0 });
    page.ngOnDestroy();
  });

  it('surfaces list errors and renders detail API state', () => {
    const list = new ActivitiesPageComponent({ list: () => throwError(() => Error('offline')) } as never,
      { queryParamMap: new BehaviorSubject(convertToParamMap({})) } as never, { navigate: vi.fn() } as never);
    list.ngOnInit(); expect(list.state()).toBe('error'); list.ngOnDestroy();
    const detail = new ActivityDetailPageComponent({ detail: () => of({ id: 'abc', activity_type: 'swim' }) } as never,
      { paramMap: new BehaviorSubject(convertToParamMap({ id: 'abc' })) } as never);
    detail.ngOnInit(); expect(detail.activity()).toMatchObject({ id: 'abc', activity_type: 'swim' });
    expect(detail.state()).toBe('loaded'); detail.ngOnDestroy();
  });
});
