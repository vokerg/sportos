import { RUNNING_EFFORT_TARGETS, runningEffortDistanceTolerance } from './running-efforts.js';

export const PERFORMANCE_MATCH_VERSION = 1;
export function performanceTarget(distanceM: number): number | null {
  const target = distanceM === 21100 ? 21097.5 : distanceM;
  return (RUNNING_EFFORT_TARGETS as readonly number[]).includes(target) ? target : null;
}
export interface HistoricalRecord {
  id: string; date: string; distanceM: number; durationS: number; treadmill: boolean;
}
export interface HistoricalWorkoutCandidate {
  id: string; date: string; distanceM: number; movingTimeS: number | null;
  subtype: string | null;
}
export interface HistoricalWorkoutCandidateDiagnostic extends HistoricalWorkoutCandidate {
  paceSPerKm: number | null; score: number | null; reason: string;
}
export interface PerformanceMatch {
  status: 'accepted' | 'ambiguous' | 'unmatched'; activityId: string | null;
  version: number; reason: string; candidates: HistoricalWorkoutCandidateDiagnostic[];
}
/** Workout identity only. Historical interval times never become calculated efforts.
 * Adjacent dates are diagnostic only: no verified timezone evidence => no auto-link.
 * Longer runs permit slower averages, but close scores always require review.
 */
export function matchHistoricalPerformance(record: HistoricalRecord, candidates: readonly HistoricalWorkoutCandidate[]): PerformanceMatch {
  const target = performanceTarget(record.distanceM);
  const pace = target ? record.durationS * 1000 / target : 0;
  const diagnostics = candidates.map(c => {
    const cp = c.movingTimeS && c.distanceM > 0 ? c.movingTimeS * 1000 / c.distanceM : null;
    let reason = 'plausible', score: number | null = null;
    if (!target || !Number.isFinite(pace) || pace < 120 || pace > 900) reason = 'unsupported_or_invalid_record';
    else if (c.date !== record.date) reason = 'uncertain_calendar_date';
    else if (!Number.isFinite(c.distanceM) || c.distanceM < target - runningEffortDistanceTolerance(target)) reason = 'too_short';
    else if ((c.subtype === 'treadmill') !== record.treadmill && c.subtype !== null && c.subtype !== 'unknown') reason = 'treadmill_conflict';
    else if (!cp || !Number.isFinite(cp) || cp < 120 || cp > 900) reason = 'missing_or_invalid_moving_pace';
    else {
      const delta = (cp - pace) / pace;
      const longerAllowance = Math.min(.45, .15 + Math.max(0, c.distanceM / target - 1) * .2);
      if (delta < -.15 || delta > longerAllowance) reason = 'implausible_pace';
      else {
        score = 100 - Math.abs(delta) * 100 - (c.subtype === null || c.subtype === 'unknown' ? 10 : 0);
        if (score < 65) { score = null; reason = 'weak_pace_evidence'; }
      }
    }
    return { ...c, paceSPerKm: cp, score, reason };
  }).sort((a,b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id));
  const plausible = diagnostics.filter(c => c.score !== null);
  const winner = plausible[0];
  const accepted = winner && (plausible.length === 1 || winner.score! - plausible[1].score! >= 12);
  return { status: accepted ? 'accepted' : winner ? 'ambiguous' : 'unmatched', activityId: accepted ? winner.id : null,
    version: PERFORMANCE_MATCH_VERSION, reason: accepted ? 'decisive_workout_identity' : winner ? 'close_candidate_scores' : 'no_plausible_workout', candidates: diagnostics };
}
