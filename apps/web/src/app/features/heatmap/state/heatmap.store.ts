import { Inject, Injectable, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { HeatmapApiService } from '../data-access/heatmap-api.service';
import { buildHeatmapDataset, type HeatmapDataset } from '../model/heatmap-geometry';
import {
  EMPTY_COVERAGE, MAX_HEATMAP_PAGES, MAX_HEATMAP_ROUTES, MAX_RAW_ROUTE_POINTS,
  type HeatmapCoverage, type HeatmapFilters, type HeatmapPage, type HeatmapRoute,
} from '../model/heatmap.models';

export type HeatmapLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
const EMPTY = (): HeatmapCoverage => ({ ...EMPTY_COVERAGE });

@Injectable()
export class HeatmapStore implements OnDestroy {
  readonly state = signal<HeatmapLoadState>('idle');
  readonly dataset = signal<HeatmapDataset | null>(null);
  readonly coverage = signal<HeatmapCoverage>(EMPTY());
  readonly pagesLoaded = signal(0);
  readonly error = signal<string | null>(null);

  private requests = new Subscription();
  private sequence = 0;
  private lastFilters: HeatmapFilters = {};

  constructor(@Inject(HeatmapApiService) private readonly api: HeatmapApiService) {}

  load(filters: HeatmapFilters): void {
    this.cancel();
    this.lastFilters = { ...filters };
    this.requests = new Subscription();
    const sequence = ++this.sequence;
    this.state.set('loading');
    this.error.set(null);
    this.dataset.set(null);
    this.coverage.set(EMPTY());
    this.pagesLoaded.set(0);
    this.nextPage(sequence, [], 0, undefined, new Set<string>(), EMPTY(), 0);
  }

  retry(): void { this.load(this.lastFilters); }

  clear(): void {
    this.cancel();
    this.dataset.set(null);
    this.coverage.set(EMPTY());
    this.state.set('idle');
    this.error.set(null);
    this.pagesLoaded.set(0);
  }

  cancel(): void {
    this.sequence++;
    this.requests.unsubscribe();
  }

  ngOnDestroy(): void { this.cancel(); this.dataset.set(null); }

  private nextPage(
    sequence: number, routes: HeatmapRoute[], rawPoints: number, cursor: string | undefined,
    usedCursors: Set<string>, coverage: HeatmapCoverage, pageCount: number,
  ): void {
    if (sequence !== this.sequence) return;
    if (pageCount >= MAX_HEATMAP_PAGES) return this.fail('The heatmap exceeds the browser page limit. Narrow your filters.');
    this.requests.add(this.api.list(this.lastFilters, cursor).subscribe({
      next: (page: HeatmapPage) => {
        if (sequence !== this.sequence) return;
        try {
          if (!page || !Array.isArray(page.items) || !page.coverage ||
              typeof page.hasMore !== 'boolean' || page.items.length > 50 ||
              !Number.isSafeInteger(page.coverage.eligibleScanned) ||
              page.coverage.eligibleScanned < page.items.length ||
              !Object.values(page.coverage).every(v => Number.isSafeInteger(v) && v >= 0)) {
            throw new Error('Invalid heatmap page.');
          }
          const nextCoverage: HeatmapCoverage = {
            eligibleScanned: coverage.eligibleScanned + page.coverage.eligibleScanned,
            usable: coverage.usable + page.coverage.usable,
            missingGps: coverage.missingGps + page.coverage.missingGps,
            invalidGeometry: coverage.invalidGeometry + page.coverage.invalidGeometry,
            budgetExceeded: coverage.budgetExceeded + page.coverage.budgetExceeded,
          };
          const pointCount = page.items.reduce((sum, item) => sum +
            (item.geometry?.type === 'LineString' ? item.geometry.coordinates.length :
             item.geometry?.type === 'MultiLineString' ? item.geometry.coordinates.reduce((total, part) => total + part.length, 0) : 0), 0);
          if (routes.length + page.items.length > MAX_HEATMAP_ROUTES ||
              rawPoints + pointCount > MAX_RAW_ROUTE_POINTS) {
            throw new RangeError('The selected archive exceeds the browser route/point budget. Narrow the filters.');
          }
          this.coverage.set(nextCoverage);
          this.pagesLoaded.set(pageCount + 1);
          const all = routes.concat(page.items);
          if (page.hasMore) {
            const next = page.nextCursor;
            if (!next || next === cursor || usedCursors.has(next) || page.coverage.eligibleScanned === 0) {
              throw new Error('The heatmap API returned an invalid pagination cursor.');
            }
            usedCursors.add(next);
            this.nextPage(sequence, all, rawPoints + pointCount, next, usedCursors, nextCoverage, pageCount + 1);
          } else {
            if (page.nextCursor !== null) throw new Error('Unexpected heatmap cursor on final page.');
            // Validate all geometries and sample budgets before allowing any map to render.
            const dataset = buildHeatmapDataset(all);
            this.dataset.set(dataset);
            this.state.set(all.length ? 'ready' : 'empty');
          }
        } catch (error) {
          this.fail(error instanceof RangeError ? error.message : 'The heatmap response could not be completed. Please retry.');
        }
      },
      error: () => {
        if (sequence === this.sequence) this.fail('The heatmap feed failed before all pages loaded. Nothing partial is displayed; please retry.');
      },
    }));
  }

  private fail(message: string): void {
    this.requests.unsubscribe();
    this.dataset.set(null);
    this.error.set(message);
    this.state.set('error');
  }
}
