export interface PerformanceRow {
  event_date: string;
  distance_m: number;
  duration_s: number;
  pace_s_per_km: number;
  is_treadmill: boolean;
  is_pr_marker: boolean;
  source_rank: number | null;
  all_time_rank: number;
  tags: string[];
}

export interface ProvenanceReference {
  status: 'available' | 'missing' | 'unsupported';
  sourceRecordId: string | null;
  sourceRecordHash: string | null;
  importBatchId: string | null;
  source: string | null;
  sheetName: string | null;
  rowIndex: number | null;
  filename: string | null;
}

export interface PerformanceEventRow {
  id: string;
  activityId: string | null;
  eventDate: string;
  source: 'manual' | 'run_db_xlsx' | 'strava' | 'garmin' | 'fit';
  distanceM: number;
  durationS: number;
  paceSPerKm: number;
  isTreadmill: boolean;
  isRace: boolean;
  isPrMarker: boolean;
  isPrByTime: boolean;
  sourceRank: number | null;
  allTimeRank: number;
  tags: string[];
  notes: string | null;
}

export interface PerformanceEventDetail extends PerformanceEventRow {
  provenance: ProvenanceReference;
}

export interface PerformanceEventQuery {
  from?: string;
  to?: string;
  limit?: number;
  distanceM?: number;
}
