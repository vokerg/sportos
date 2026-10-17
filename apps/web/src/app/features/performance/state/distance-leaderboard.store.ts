import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { isCalendarDate } from '../../../shared/util/analytics-query-state';
import { PerformanceApiService } from '../data-access/performance-api.service';
import type { DistanceLeaderboard } from '../model/performance.models';
@Injectable()
export class DistanceLeaderboardStore implements OnDestroy {
  private readonly api=inject(PerformanceApiService);
  private request?: Subscription;
  readonly distanceM=signal(5000);
  readonly targets=signal<number[]>([5000]);
  readonly from=signal(''); readonly to=signal('');
  readonly result=signal<DistanceLeaderboard|null>(null);
  readonly loading=signal(false); readonly error=signal<string|null>(null);
  load() {
    this.request?.unsubscribe(); this.result.set(null); this.error.set(null); this.loading.set(false);
    if ((this.from() && !isCalendarDate(this.from())) || (this.to() && !isCalendarDate(this.to())) || (this.from() && this.to() && this.from()>this.to())) {
      this.error.set('Choose a valid date range.'); return;
    }
    this.loading.set(true);
    this.request=this.api.leaderboard({distanceM:this.distanceM(),from:this.from()||undefined,to:this.to()||undefined,limit:200}).subscribe({
      next: result=>{this.targets.set(result.targets);this.result.set(result);this.loading.set(false);},
      error: ()=>{this.error.set('Distance leaderboard could not be loaded. Retry to refresh current evidence.');this.loading.set(false);},
    });
  }
  ngOnDestroy(){this.request?.unsubscribe();}
}
