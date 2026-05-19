import { secondsToPacePerKm } from './units.js';

export interface PerformanceCandidate {
  eventDate: string;
  distanceM: number;
  durationS: number;
  isTreadmill?: boolean;
  isRace?: boolean;
  isPrMarker?: boolean;
  sourceRank?: number;
  tags?: string[];
  notes?: string;
  rawPayloadJson?: Record<string, unknown>;
}

export function buildPerformanceEvent(candidate: PerformanceCandidate): PerformanceCandidate & { paceSPerKm: number } {
  return {
    ...candidate,
    paceSPerKm: secondsToPacePerKm(candidate.durationS, candidate.distanceM),
  };
}

export function inferDistanceFromSheetName(sheetName: string): number | null {
  const normalized = sheetName.toLowerCase();
  if (normalized.includes('5k')) return 5000;
  if (normalized.includes('10k')) return 10000;
  if (normalized === '12') return 12000;
  if (normalized === 'm') return 42195;
  if (normalized.includes('21') || normalized.includes('лист14')) return 21100;
  return null;
}
