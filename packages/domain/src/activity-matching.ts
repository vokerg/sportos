import type { ActivitySubtype, ActivityType } from './types.js';

/** Only compact, explicitly normalized observations enter the resolver. */
export interface ActivityMatchSummary {
  activityType: ActivityType;
  subtype: ActivitySubtype;
  startTime: Date;
  elapsedTimeS: number | null;
  movingTimeS: number | null;
  distanceM: number | null;
}
export interface ActivityMatchCandidate extends ActivityMatchSummary { id: string; }
export interface ActivityMatchEvidence {
  activityId: string;
  confidence: 'exact' | 'strong' | 'weak';
  reasons: string[];
}
export interface ActivityMatchResult {
  policyVersion: 1;
  status: 'exact' | 'strong_unique' | 'ambiguous' | 'unmatched';
  activityId: string | null;
  candidates: ActivityMatchEvidence[];
}

export const GARMIN_MATCH_POLICY = Object.freeze({
  version: 1, candidateStartS: 120, strongStartS: 15,
  durationFloorS: 5, durationFraction: 0.01,
  distanceFloorM: 200, distanceFraction: 0.05,
});

export function validateActivityMatchSummary(summary: ActivityMatchSummary): void {
  if (!(summary.startTime instanceof Date) || !Number.isFinite(summary.startTime.getTime())
    || !['run', 'bike', 'swim', 'workout', 'rowing', 'sup'].includes(summary.activityType)
    || !['outdoor', 'indoor', 'treadmill', 'track', 'manual', 'race', 'unknown'].includes(summary.subtype)) {
    throw new Error('Invalid activity matching summary.');
  }
  for (const [value, max] of [[summary.elapsedTimeS, 604800], [summary.movingTimeS, 604800], [summary.distanceM, 1000000]]) {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max!)) {
      throw new Error('Invalid activity matching metric.');
    }
  }
  if (summary.movingTimeS !== null && summary.elapsedTimeS !== null && summary.movingTimeS > summary.elapsedTimeS + 5) {
    throw new Error('Moving duration exceeds elapsed duration.');
  }
}

/** Account filtering is the caller's responsibility; never use local date as identity. */
export function matchGarminActivity(summary: ActivityMatchSummary, candidates: ActivityMatchCandidate[]): ActivityMatchResult {
  validateActivityMatchSummary(summary);
  if (candidates.length > 100) throw new Error('Activity matching candidate limit exceeded.');
  const evidence: ActivityMatchEvidence[] = [];
  for (const candidate of candidates) {
    validateActivityMatchSummary(candidate);
    if (summary.activityType !== candidate.activityType || incompatibleSubtype(summary.subtype, candidate.subtype)) continue;
    const startS = Math.abs(summary.startTime.getTime() - candidate.startTime.getTime()) / 1000;
    if (startS > GARMIN_MATCH_POLICY.candidateStartS) continue;
    // Missing metrics never count as corroboration. Elapsed compares to elapsed,
    // moving to moving: pauses must not masquerade as cross-provider agreement.
    const elapsed = compare(summary.elapsedTimeS, candidate.elapsedTimeS, 5, 0.01);
    const moving = compare(summary.movingTimeS, candidate.movingTimeS, 5, 0.01);
    const distance = compare(summary.distanceM, candidate.distanceM, 200, 0.05);
    const reasons = [`START_DELTA_${Math.round(startS)}S`];
    if (elapsed === 'close') reasons.push('ELAPSED_COMPATIBLE');
    if (moving === 'close') reasons.push('MOVING_COMPATIBLE');
    if (distance === 'close') reasons.push('DISTANCE_COMPATIBLE');
    if (elapsed === 'conflict' || moving === 'conflict' || distance === 'conflict') reasons.push('METRIC_CONFLICT');
    const exact = startS === 0 && elapsed === 'close' && summary.elapsedTimeS === candidate.elapsedTimeS
      && summary.subtype === candidate.subtype && summary.subtype !== 'unknown'
      && summary.movingTimeS === candidate.movingTimeS && summary.distanceM === candidate.distanceM;
    const explicitSubtype = summary.subtype !== 'unknown' && candidate.subtype !== 'unknown';
    const strong = summary.activityType !== 'workout' && startS <= GARMIN_MATCH_POLICY.strongStartS
      && elapsed === 'close' && moving !== 'conflict' && distance !== 'conflict'
      && ((distance === 'close' && Math.max(summary.distanceM!, candidate.distanceM!) > 0)
        || (explicitSubtype && moving === 'close'));
    evidence.push({ activityId: candidate.id, confidence: exact ? 'exact' : strong ? 'strong' : 'weak', reasons });
  }
  evidence.sort((a, b) => a.activityId.localeCompare(b.activityId));
  // A nearby weak observation is still a plausible collision. Never pick the
  // highest score out of multiple workouts, even when one is an exact match.
  const only = evidence.length === 1 ? evidence[0]! : null;
  const status = only?.confidence === 'exact' ? 'exact' : only?.confidence === 'strong' ? 'strong_unique'
    : evidence.length ? 'ambiguous' : 'unmatched';
  return { policyVersion: 1, status, activityId: status === 'exact' || status === 'strong_unique' ? only!.activityId : null, candidates: evidence };
}

function compare(a: number | null, b: number | null, floor: number, fraction: number): 'missing' | 'close' | 'conflict' {
  if (a === null || b === null) return 'missing';
  return Math.abs(a - b) <= Math.max(floor, Math.max(a, b) * fraction) ? 'close' : 'conflict';
}
function incompatibleSubtype(a: ActivitySubtype, b: ActivitySubtype): boolean {
  const indoor = (s: ActivitySubtype) => s === 'indoor' || s === 'treadmill';
  const outdoor = (s: ActivitySubtype) => ['outdoor', 'race', 'track'].includes(s);
  return (indoor(a) && outdoor(b)) || (outdoor(a) && indoor(b));
}
