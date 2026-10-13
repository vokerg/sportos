/** Authenticated heatmap API contract. #139 may supply MultiLineString routes. */
export type Coordinate = [number, number];
export type RouteGeometry =
  | { type: 'LineString'; coordinates: Coordinate[] }
  | { type: 'MultiLineString'; coordinates: Coordinate[][] };
export const HEATMAP_SPORTS = ['walk','steps','run','bike','swim','workout','rowing','sup','hiit','bonus'] as const;
export type HeatmapSport = typeof HEATMAP_SPORTS[number];
export interface HeatmapFilters { from?: string; to?: string; activityType?: HeatmapSport }
export interface HeatmapRoute {
  activityId: string; date: string; sport: HeatmapSport;
  source: 'strava' | 'garmin'; resolution: string; geometry: RouteGeometry;
}
export interface HeatmapCoverage {
  eligibleScanned: number; usable: number; missingGps: number; invalidGeometry: number; budgetExceeded: number;
}
export interface HeatmapPage {
  items: HeatmapRoute[]; limit: number; hasMore: boolean; nextCursor: string | null;
  partial: boolean; coverage: HeatmapCoverage;
}
export const EMPTY_COVERAGE: HeatmapCoverage = {
  eligibleScanned: 0, usable: 0, missingGps: 0, invalidGeometry: 0, budgetExceeded: 0,
};
export const HEATMAP_PAGE_SIZE = 50;
export const MAX_HEATMAP_PAGES = 120;
export const MAX_HEATMAP_ROUTES = 2500;
export const MAX_RAW_ROUTE_POINTS = 160_000;
export const MAX_DENSITY_SAMPLES = 180_000;
