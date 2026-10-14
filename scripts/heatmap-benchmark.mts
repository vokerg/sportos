/** Read-only local operator benchmark. Requires the local API's authenticated
 * dev-single-user mode; no owner, credentials or provider requests are accepted.
 * Prints aggregate performance/coverage only, never coordinates or identifiers.
 * Node heap is not a browser peak-memory or frame-rate measurement.
 */
import { performance } from 'node:perf_hooks';
import { HeatmapDatasetBuilder } from '../apps/web/src/app/features/heatmap/model/heatmap-geometry.ts';
import { decodeHeatmapPage } from '../apps/web/src/app/features/heatmap/model/heatmap-transport.ts';
import { EMPTY_COVERAGE, HEATMAP_PAGE_SIZE, MAX_HEATMAP_PAGES } from '../apps/web/src/app/features/heatmap/model/heatmap.models.ts';

async function benchmark() {
  let cursor: string | null = null;
  let bytes = 0, pages = 0, computeMs = 0;
  const seen = new Set<string>();
  const cursors = new Set<string>();
  const coverage = { ...EMPTY_COVERAGE, quality: { ...EMPTY_COVERAGE.quality } };
  const durations: number[] = [];
  const builder = new HeatmapDatasetBuilder();
  const start = performance.now();
  do {
    const url = new URL('http://localhost:3010/heatmap/routes');
    url.searchParams.set('limit', String(HEATMAP_PAGE_SIZE));
    url.searchParams.set('encoding', 'polyline5');
    if (cursor) url.searchParams.set('cursor', cursor);
    const requestStart = performance.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || response.headers.get('cache-control') !== 'private, no-store') {
      throw new Error('Unavailable or unsafe route feed.');
    }
    const raw = await response.text();
    durations.push(Math.round(performance.now() - requestStart));
    bytes += Buffer.byteLength(raw);
    pages++;
    const computeStart = performance.now();
    const page = decodeHeatmapPage(JSON.parse(raw));
    for (const item of page.items) {
      if (seen.has(item.activityId)) throw new Error('Duplicate route.');
      seen.add(item.activityId);
    }
    builder.add(page.items);
    computeMs += performance.now() - computeStart;
    for (const key of ['eligibleScanned', 'usable', 'missingGps', 'invalidGeometry', 'budgetExceeded'] as const) {
      coverage[key] += page.coverage[key];
    }
    for (const key of ['summary', 'streams', 'detail', 'fit'] as const) {
      coverage.quality[key] += page.coverage.quality[key];
    }
    cursor = page.nextCursor;
    if (page.hasMore !== !!cursor || pages > MAX_HEATMAP_PAGES || (cursor && cursors.has(cursor))) {
      throw new Error('Invalid pagination.');
    }
    if (cursor) cursors.add(cursor);
  } while (cursor);
  const dataset = builder.finish();
  console.log(JSON.stringify({
    pages, bytes, coverage,
    durationMs: Math.round(performance.now() - start), computeMs: Math.round(computeMs),
    pageMs: {
      min: Math.min(...durations), max: Math.max(...durations),
      mean: Math.round(durations.reduce((sum, value) => sum + value, 0) / pages),
    },
    dataset: {
      routes: dataset.routes, rawPoints: dataset.rawPoints, renderedPoints: dataset.renderedPoints,
      samples: dataset.samples, densityCells: dataset.densityCells,
      features: dataset.geojson.features.length,
      geojsonBytes: Buffer.byteLength(JSON.stringify(dataset.geojson)),
    },
    heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  }, null, 2));
}

benchmark().catch(() => {
  console.error('Heatmap benchmark failed. Start the authenticated local API and check its availability and geometry budgets.');
  process.exitCode = 1;
});
