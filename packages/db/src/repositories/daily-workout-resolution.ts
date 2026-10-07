import { workoutPointsFromSets } from '@sportos/domain';
import type { ActivityFact } from '@sportos/domain';
import type { DailyWorkoutCalculation } from '../repository-contracts.js';
export interface WorkoutSetEvidence {
  activityId: string; identityId: string; workingSets: number; complete: boolean;
  sourceVersionId: string; sourceUpdatedAt: string; derivedAt: string;
}
export function resolveDailyWorkout(stored: number, manual: ActivityFact[], imported: boolean,
  evidence: WorkoutSetEvidence[], incompleteReason?: string): DailyWorkoutCalculation {
  const manualPoints = Math.round(manual.filter(a => a.activityType === 'workout').reduce((sum, a) => sum + (a.effortPoints ?? 0), 0));
  if (manualPoints > 0) return { source: 'manual', resolvedPoints: manualPoints };
  const unique = [...new Map(evidence.map(item => [item.identityId, item])).values()];
  const reason = incompleteReason ?? (unique.some(item => !item.complete) ? 'Some retained set types are missing or unclassified.' : undefined);
  if (unique.length && !reason) {
    const workingSets = unique.reduce((sum, item) => sum + item.workingSets, 0);
    return { source: 'garmin_sets', resolvedPoints: workoutPointsFromSets(workingSets), policyVersion: 1,
      workingSets, pointsPerThreeSets: 1000,
      activities: unique.map(({ activityId, identityId, workingSets, sourceVersionId, sourceUpdatedAt, derivedAt }) =>
        ({ activityId, identityId, workingSets, sourceVersionId, sourceUpdatedAt, derivedAt })) };
  }
  return { source: stored > 0 ? imported ? 'imported' : 'stored' : 'none', resolvedPoints: stored,
    ...(reason ? { incompleteReason: reason } : {}) };
}
