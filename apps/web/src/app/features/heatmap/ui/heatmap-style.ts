/**
 * Adapted from vokerg/heatmap/apps/web/src/app/map-style.ts.
 * GeoJSON point density + line geometry, not the upstream MVT/file-mode endpoints.
 * Tiles are requested only from OSM; private route GeoJSON remains in memory.
 */
export const HEATMAP_SOURCE_ID = 'sportos-heatmap';
const densityFilter = ['==', ['get', 'kind'], 'density'];
const routeFilter = ['==', ['get', 'kind'], 'route'];

export function heatmapRasterStyle(): object {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e9ece8' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.28, 'raster-opacity': 0.88 } },
    ],
  };
}

export function heatmapLayers(): object[] {
  return [
    {
      id: 'heatmap-halo', type: 'heatmap', source: HEATMAP_SOURCE_ID, filter: densityFilter, maxzoom: 14.7,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 0], 0, 0, 3, 0.35, 18, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 0.85, 13, 1.15, 16, 1.3],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 11, 9, 15, 11, 17, 12],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.72, 13, 0.55, 14.7, 0],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(80, 30, 210, 0)', 0.12, 'rgba(113, 44, 255, 0.16)',
          0.32, 'rgba(105, 25, 245, 0.48)', 0.62, 'rgba(91, 0, 225, 0.82)',
          1, 'rgba(64, 0, 176, 0.98)'],
      },
    },
    {
      id: 'heatmap-core', type: 'heatmap', source: HEATMAP_SOURCE_ID, filter: densityFilter,
      minzoom: 9, maxzoom: 14.5,
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 0], 0, 0, 2, 0.5, 12, 1],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.72, 14, 1.05, 16, 1.15],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 13, 5, 16, 7],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 13, 0.5, 14.5, 0],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(120, 55, 255, 0)', 0.24, 'rgba(123, 55, 255, 0.3)',
          0.55, 'rgba(95, 16, 235, 0.8)', 1, 'rgba(49, 0, 142, 1)'],
      },
    },
    {
      id: 'route-glow', type: 'line', source: HEATMAP_SOURCE_ID, filter: routeFilter, minzoom: 13,
      paint: {
        'line-color': '#6b20ef',
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, 4.5],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.12, 16, 0.3, 18, 0.42],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 18, 1.7],
      },
    },
    {
      id: 'route-core', type: 'line', source: HEATMAP_SOURCE_ID, filter: routeFilter, minzoom: 14,
      paint: {
        'line-color': '#5010ca',
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.55, 18, 1.6],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.32, 18, 0.68],
      },
    },
  ];
}
