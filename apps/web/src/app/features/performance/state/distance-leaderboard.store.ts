import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, of, switchMap } from 'rxjs';
import { isCalendarDate } from '../../../shared/util/analytics-query-state';
import { PerformanceApiService } from '../data-access/performance-api.service';
import type { DistanceLeaderboard } from '../model/performance.models';
type Filters = { distanceM: number; from?: string; to?: string };
@Injectable()
export class DistanceLeaderboardStore implements OnDestroy {
  private readonly api=inject(PerformanceApiService);
  private request?: Subscription;
  private appliedFilters: Filters | null = null;
  readonly distanceM=signal(5000);
  readonly targets=signal<number[]>([5000]);
  readonly from=signal(''); readonly to=signal('');
  readonly pageSize=signal(100); readonly offset=signal(0);
  readonly result=signal<DistanceLeaderboard|null>(null);
  readonly loading=signal(false); readonly error=signal<string|null>(null);
  load() {
    this.request?.unsubscribe(); this.result.set(null); this.error.set(null); this.loading.set(false); this.offset.set(0);
    if ((this.from() && !isCalendarDate(this.from())) || (this.to() && !isCalendarDate(this.to())) || (this.from() && this.to() && this.from()>this.to())) {
      this.appliedFilters=null; this.error.set('Choose a valid date range.'); return;
    }
    this.appliedFilters={distanceM:this.distanceM(),from:this.from()||undefined,to:this.to()||undefined};
    this.requestPage(0);
  }
  setPageSize(size: number) {
    if (![50,100,200].includes(size)) return;
    this.pageSize.set(size); this.load();
  }
  goTo(offset: number) {
    const result=this.result();
    if (!result || this.loading() || !Number.isInteger(offset) || offset<0) return;
    const last=Math.max(0,Math.floor((result.total-1)/this.pageSize())*this.pageSize());
    const next=Math.min(offset,last);
    if (next!==this.offset()) this.requestPage(next);
  }
  retry() { if(this.appliedFilters) this.requestPage(this.offset()); else this.load(); }
  private requestPage(offset: number) {
    if (!this.appliedFilters) return;
    this.request?.unsubscribe(); this.offset.set(offset); this.result.set(null); this.error.set(null); this.loading.set(true);
    const query={...this.appliedFilters,limit:this.pageSize(),offset};
    this.request=this.api.leaderboard(query).pipe(switchMap(result=>{
      // A correction or deletion can shrink the qualified set between requests.
      const last=Math.max(0,Math.floor((result.total-1)/query.limit)*query.limit);
      return offset>last ? this.api.leaderboard({...query,offset:last}) : of(result);
    })).subscribe({
      next: result=>{this.targets.set(result.targets);this.offset.set(result.offset);this.result.set(result);this.loading.set(false);},
      error: ()=>{this.error.set('Distance leaderboard could not be loaded. Retry to refresh current evidence.');this.loading.set(false);},
    });
  }
  ngOnDestroy(){this.request?.unsubscribe();}
}
