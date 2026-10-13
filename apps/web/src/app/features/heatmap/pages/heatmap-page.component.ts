import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, effect, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HEATMAP_SPORTS, type HeatmapFilters, type HeatmapSport } from '../model/heatmap.models';
import { HeatmapStore } from '../state/heatmap.store';
import { HEATMAP_SOURCE_ID, heatmapLayers, heatmapRasterStyle } from '../ui/heatmap-style';
import { loadMapLibre, type MapInstance } from '../../activities/ui/maplibre-loader';
import { isCalendarDate, quickRangeDates, type QuickRange } from '../../../shared/util/analytics-query-state';
import type { HeatmapDataset } from '../model/heatmap-geometry';

@Component({
  selector: 'sportos-heatmap-page',
  standalone: true,
  imports: [RouterLink],
  providers: [HeatmapStore],
  template: `
    <section class="heatmap-page">
      <header>
        <div><span class="page-kicker">Training geography</span><h1>My heatmap</h1>
          <p>Private routes from retained activity GPS. Summary geometry is approximate, not a street-level trace.</p>
        </div>
        <a routerLink="/activities">Activities ↗</a>
      </header>
      <form class="filters card" (submit)="apply($event)" aria-label="Heatmap filters">
        <label>Time range
          <select [value]="range()" (change)="setRange($any($event.target).value)">
            <option value="all">All time</option><option value="1m">1 month</option>
            <option value="3m">3 months</option><option value="6m">6 months</option>
            <option value="ytd">Year to date</option><option value="1y">1 year</option>
            <option value="3y">3 years</option><option value="custom">Custom</option>
          </select>
        </label>
        <label>From <input type="date" [value]="from()" (change)="setFrom($any($event.target).value)" /></label>
        <label>To <input type="date" [value]="to()" (change)="setTo($any($event.target).value)" /></label>
        <label>Sport <select [value]="sport()" (change)="setSport($any($event.target).value)">
          <option value="">All eligible sports</option>
          @for (item of sports; track item) { <option [value]="item">{{ item }}</option> }
        </select></label>
        <button type="submit">Apply</button>
        <button type="button" class="secondary" (click)="reset()">Reset</button>
      </form>
      @if (filterError()) { <p class="notice error" role="alert">{{ filterError() }}</p> }
      <div class="summary" role="status" aria-live="polite">
        @if (store.state() === 'loading') {
          Loading private routes… {{ store.pagesLoaded() }} pages read, {{ store.coverage().eligibleScanned }} eligible activities scanned. The map appears only after all pages succeed.
        } @else if (store.state() === 'ready' || store.state() === 'empty') {
          <strong>{{ store.coverage().usable }} GPS routes</strong> of {{ store.coverage().eligibleScanned }} eligible activities.
          @if (store.coverage().missingGps) { {{ store.coverage().missingGps }} without GPS. }
          @if (store.coverage().invalidGeometry) { {{ store.coverage().invalidGeometry }} invalid. }
          @if (store.coverage().budgetExceeded) { {{ store.coverage().budgetExceeded }} omitted by API page budgets. }
          <span>All requested pages loaded · Strava summary / approximate geometry</span>
        }
      </div>
      @if (store.state() === 'error') {
        <div class="notice error" role="alert">{{ store.error() }} <button type="button" (click)="store.retry()">Retry feed</button></div>
      } @else if (store.state() === 'empty') {
        <div class="notice">No usable GPS routes for this selection. Try more dates or another sport; an activity can be eligible but have no retained route.</div>
      }
      @if (mapError()) {
        <div class="notice error" role="alert">The map could not be displayed. <button type="button" (click)="retryMap()">Retry map</button></div>
      }
      @if (tilesFailed()) { <p class="notice">OpenStreetMap tiles may be unavailable; retained route geometry is still private and unchanged.</p> }
      <div class="map-wrap">
        <div #mapCanvas class="map" role="region" tabindex="0" aria-label="Personal activity density heatmap"></div>
        @if (store.state() !== 'ready') { <div class="map-placeholder">{{ store.state() === 'loading' ? 'Loading complete coverage…' : 'No map to show' }}</div> }
        @else if (mapLoading()) { <div class="map-placeholder" role="status">Preparing interactive map…</div> }
        @if (store.state() === 'ready' && !mapLoading() && !mapError()) {
          <button type="button" class="fit" (click)="fitRoutes()">Fit routes</button>
        }
      </div>
      <footer>
        <div class="legend" aria-label="Route density legend"><span>Less travelled</span>
          <div class="gradient" aria-hidden="true"></div><span>Repeated routes</span>
        </div>
        <p>At regional zoom repeated paths form brighter corridors; zoom in for approximate routes. Interpolation adjusts density, not GPS accuracy. © OpenStreetMap contributors.</p>
      </footer>
    </section>
  `,
  styles: [`
    .heatmap-page{display:grid;gap:12px;min-height:0}
    header{display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;align-items:center}
    .page-kicker{color:#5368ae;font-size:11px;font-weight:800;text-transform:uppercase}
    h1{margin:3px 0 6px;font-size:27px}header p,footer p{margin:0;color:#667085;font-size:13px}
    header a{color:#1d4ed8;font-weight:700;font-size:13px}
    .filters{display:flex;gap:12px;flex-wrap:wrap;align-items:end;padding:14px}
    label{display:grid;gap:4px;color:#475467;font-size:12px;font-weight:700}
    input,select{min-height:36px;padding:6px 8px;min-width:110px;border:1px solid #cbd5e1;border-radius:7px;color:#172033;background:white}
    .filters button{min-height:36px}.summary{font-size:13px;color:#475467;display:flex;gap:7px;flex-wrap:wrap;align-items:center}
    .summary span{margin-left:auto;color:#667085}.notice{font-size:13px;background:#f8fafc;border-radius:8px;padding:10px 12px}
    .error{color:#a52834;background:#fff1f1}.map-wrap{position:relative;min-height:420px;height:clamp(440px,65vh,880px);border-radius:13px;overflow:hidden;background:#eef2f5}
    .map{height:100%;width:100%}.map:focus-visible{outline:3px solid #f59e0b;outline-offset:-3px}
    .map-placeholder{position:absolute;inset:0;display:grid;place-items:center;background:#eef2f5;color:#5d6880;text-align:center;padding:24px}
    .fit{position:absolute;right:14px;bottom:24px;background:#fff;color:#172033;border:1px solid #d0d5dd;box-shadow:0 2px 9px #0002}
    footer{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap}
    .legend{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#475467}
    .gradient{width:160px;height:12px;border-radius:6px;background:linear-gradient(90deg,#e7dfff,#a976ff,#6d24e5,#4000b0)}
    footer p{flex:1;min-width:260px;text-align:right}
    @media(max-width:700px){.map-wrap{height:60vh;min-height:340px}footer p{text-align:left}}
  `],
})
export class HeatmapPageComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly sports = HEATMAP_SPORTS;
  readonly range = signal<QuickRange>('all');
  readonly from = signal('');
  readonly to = signal('');
  readonly sport = signal('');
  readonly filterError = signal<string | null>(null);
  readonly mapLoading = signal(false);
  readonly mapError = signal(false);
  readonly tilesFailed = signal(false);
  private readonly viewReady = signal(false);
  private readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('mapCanvas');
  private map?: MapInstance;
  private destroyed = false;
  private mapGeneration = 0;
  private fitBounds: [[number, number], [number, number]] | null = null;

  constructor(readonly store: HeatmapStore) {
    effect(() => {
      const ready = this.viewReady();
      const state = this.store.state();
      const dataset = this.store.dataset();
      if (!ready) return;
      if (state === 'ready' && dataset) void this.renderMap(dataset);
      else this.removeMap();
    });
  }

  ngOnInit(): void { this.store.load({}); }
  ngAfterViewInit(): void { this.viewReady.set(true); }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.removeMap();
    this.store.ngOnDestroy();
  }

  setRange(value: string): void {
    const options: QuickRange[] = ['all','1m','3m','6m','ytd','1y','3y','custom'];
    if (!options.includes(value as QuickRange)) return;
    const range = value as QuickRange;
    this.range.set(range);
    if (range === 'custom') return;
    const dates = quickRangeDates(range);
    this.from.set(dates.from);
    this.to.set(dates.to);
    this.reload();
  }
  setFrom(value: string): void { this.from.set(value); this.range.set('custom'); }
  setTo(value: string): void { this.to.set(value); this.range.set('custom'); }
  setSport(value: string): void {
    if (value && !HEATMAP_SPORTS.includes(value as HeatmapSport)) return;
    this.sport.set(value);
    this.reload();
  }
  apply(event: Event): void { event.preventDefault(); this.reload(); }
  reset(): void {
    this.range.set('all'); this.from.set(''); this.to.set(''); this.sport.set('');
    this.reload();
  }
  private reload(): void {
    const from = this.from(), to = this.to();
    if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to)) || (from && to && from > to)) {
      this.store.cancel();
      this.removeMap();
      this.filterError.set('Choose valid dates, with From no later than To.');
      return;
    }
    this.filterError.set(null);
    const query: HeatmapFilters = {};
    if (from) query.from = from;
    if (to) query.to = to;
    if (this.sport()) query.activityType = this.sport() as HeatmapSport;
    this.store.load(query);
  }

  retryMap(): void {
    const data = this.store.dataset();
    if (data && this.store.state() === 'ready') void this.renderMap(data);
  }
  fitRoutes(): void {
    if (this.map && this.fitBounds) this.map.fitBounds(this.fitBounds, { padding: 50, maxZoom: 14, duration: 0 });
  }
  private removeMap(): void {
    this.mapGeneration++;
    this.map?.remove();
    this.map = undefined;
    this.fitBounds = null;
    this.mapLoading.set(false);
  }
  private async renderMap(data: HeatmapDataset): Promise<void> {
    this.removeMap();
    const generation = ++this.mapGeneration;
    this.mapError.set(false);
    this.tilesFailed.set(false);
    this.mapLoading.set(true);
    try {
      const lib = await loadMapLibre();
      if (this.destroyed || generation !== this.mapGeneration) return;
      const bounds = data.bounds;
      if (!bounds) throw new Error('No route bounds.');
      this.fitBounds = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
      const map = new lib.Map({
        container: this.canvas().nativeElement, style: heatmapRasterStyle(), center: [0, 0],
        zoom: 2, maxZoom: 18, attributionControl: { compact: false },
      });
      this.map = map;
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
      map.on('error', () => {
        if (!this.destroyed && generation === this.mapGeneration) this.tilesFailed.set(true);
      });
      map.on('load', () => {
        if (this.destroyed || generation !== this.mapGeneration) return;
        try {
          map.addSource(HEATMAP_SOURCE_ID, { type: 'geojson', data: data.geojson });
          for (const layer of heatmapLayers()) map.addLayer(layer);
          this.fitRoutes();
          this.mapLoading.set(false);
        } catch {
          this.mapLoading.set(false);
          this.mapError.set(true);
        }
      });
    } catch {
      if (this.destroyed || generation !== this.mapGeneration) return;
      this.mapLoading.set(false);
      this.mapError.set(true);
    }
  }
}
