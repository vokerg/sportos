import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ActivityDetailStore } from '../state/activity-detail.store';
import { ActivityMapComponent } from '../ui/activity-map.component';
import { startTime, title } from '../activity.view-model';

@Component({
  selector: 'sportos-activity-map-page',
  standalone: true,
  imports: [RouterLink, ActivityMapComponent],
  providers: [ActivityDetailStore],
  template: `
    <section class="map-page" aria-label="Full-page activity map">
      <header>
        <a [routerLink]="['/activity', id]">← Back to activity</a>
        @if (store.activity(); as item) {
          <h1>{{ item.source === 'strava' && item.notes ? item.notes : title(item) }}</h1>
          <span>{{ item.activity_date }} @if (startTime(item.start_time)) { · {{ startTime(item.start_time) }} }</span>
        } @else { <h1>Activity map</h1> }
      </header>
      @if (store.state() === 'loading') { <p class="status" role="status">Loading activity…</p> }
      @else if (store.state() === 'missing') { <p class="status">Activity not found.</p> }
      @else if (store.state() === 'error') { <p class="status" role="alert">Could not load this activity. <button type="button" (click)="load()">Try again</button></p> }
      @else if (store.mapState() === 'loading') { <p class="status" role="status">Loading activity route…</p> }
      @else if (store.mapState() === 'available' && store.mapData()) {
        <sportos-activity-map [route]="store.mapData()!" [expanded]="true" />
      }
      @else if (store.mapState() === 'error') { <p class="status" role="alert">Could not load the GPS route. <button type="button" (click)="store.loadMap()">Try again</button></p> }
      @else if (store.mapState() === 'unavailable') {
        <p class="status">{{ store.mapReason() === 'indoor_pool_swim' ? 'Indoor pool swims do not have a GPS route.' : store.mapReason() === 'invalid_geometry' ? 'The retained GPS route is invalid.' : store.mapReason() === 'summary_polyline_missing' ? 'No Strava summary GPS route was retained for this activity.' : 'No GPS route is available for this activity.' }}</p>
      }
    </section>
  `,
  styles: [`
    .map-page{display:flex;flex-direction:column;background:var(--surface);height:100dvh}
    header{display:flex;align-items:center;flex-wrap:wrap;gap:10px 24px;padding:12px 16px;border-bottom:1px solid var(--border)}
    header a{color:var(--link);font-size:14px;font-weight:700}h1{margin:0;font-size:18px;overflow-wrap:anywhere}
    header span{color:var(--text-muted);font-size:13px}.status{padding:16px}sportos-activity-map{flex:1;min-height:0}
  `],
})
export class ActivityMapPageComponent implements OnInit, OnDestroy {
  readonly startTime = startTime;
  readonly title = title;
  id = '';
  private routeSubscription?: Subscription;

  constructor(readonly store: ActivityDetailStore, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe(params => {
      this.id = params.get('id') ?? '';
      this.load();
    });
  }

  load(): void { this.store.load(this.id, { coverage: false }); }
  ngOnDestroy(): void { this.routeSubscription?.unsubscribe(); this.store.ngOnDestroy(); }
}
