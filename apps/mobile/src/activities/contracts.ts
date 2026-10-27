/** Owner-scoped read projections: no raw source/provider JSON, identities or storage paths. */
export type Sport = 'steps'|'walk'|'run'|'bike'|'swim'|'workout'|'rowing'|'sup'|'hiit'|'bonus';
export type Provider = 'strava'|'garmin';
export interface ProviderMetrics {
  provider: Provider; linked: boolean; rawRetained: boolean | null; compactOnly: boolean;
  state: 'not_linked'|'linked_unprocessed'|'linked_no_rich_data'|'raw_retained_unprocessed'|'processed'|'partial'|'failed'|'stale';
}
export interface Activity {
  id: string; activity_date: string; start_time: string|null; activity_type: Sport; subtype: string|null;
  source: string; distance_m: number|null; duration_s: number|null; moving_time_s: number|null;
  avg_hr: number|null; max_hr: number|null; steps: number|null; calories: number|null;
  elevation_gain_m: number|null; avg_speed_mps: number|null; avg_pace_s_per_km: number|null;
  historicalSummary: boolean; providerMetrics: ProviderMetrics[];
  distanceCorrection: {effectiveDistanceM:number;recordedDistanceM:number;revision:number}|null;
}
export interface ActivityList { items: Activity[]; count: number; limit: number; offset: number }
export interface EffortProvider {
  provider: Provider; state: string;
  efforts: Array<{targetDistanceM:number;method:'summary_estimate'|'stream_calculated'|'fit_calculated';
    status:'estimated'|'calculated'|'unavailable';durationS:number|null}>;
}
export interface MetricComparison { key:string;label:string;unit:string;value:number;source:string }
export interface GarminStrength {
  workingSets: number; totalRecordedSets: number; warmupSets: number; restMarkers: number;
  complete: boolean; exercises: Array<{name:string;workingSets:number}>;
}
export interface ActivityDetail extends Activity {
  bestEfforts: EffortProvider[]; metricComparisons: MetricComparison[];
  garminStrength: GarminStrength|null; linkedStrava:boolean; linkedGarmin:boolean;
  provenance:string|null; name:string|null;
}
export interface Enrichment {
  strava: 'cached'|'missing'|'stale'|'unavailable';
  garmin: 'cached'|'linked'|'missing'; garminFetchEnabled:boolean;
}
export interface SwimLength {
  row:number; lengthNumber:number|null; kind:'active'|'rest'|'unknown';
  durationS:number|null; durationBasis:'timer'|'elapsed'|null;
  paceSPer100M:number|null; strokes:number|null; swolf:number|null; stroke:string|null;
}
export type SwimLengths = {status:'unavailable';reason:string|null;lengths:[]} | {
  status:'available'; lengths:SwimLength[]; poolLengthM:number|null; complete:boolean|null;
  truncated:boolean; expectedLengths:number|null; recordedDistanceM:number|null;
  effectiveDistanceM:number|null; effectiveActiveLengths:number|null;
}
export interface RunLap {row:number;distanceM:number|null;durationS:number|null;basis:string|null;paceSPerKm:number|null;heartRate:number|null}
export interface RunLapBatch {rows:RunLap[];truncated:boolean}
export type GarminSetRows = Array<Array<{label:string;value:string}>>;
export interface MetricRow {label:string;value:string}
export interface EffortRow {provider:Provider;method:string;status:string;distanceM:number;durationS:number}
