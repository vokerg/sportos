/** Retained Connect exerciseSets policy v1. Unknown semantics never score. */
export interface GarminStrengthSummary {
  policyVersion: 1;
  totalRecordedSets: number;
  workingSets: number;
  warmupSets: number;
  restMarkers: number;
  unknownSets: number;
  exerciseCount: number;
  exercises: Array<{ name: string; workingSets: number }>;
  complete: boolean;
}

export function normalizeGarminStrength(payloads: unknown[]): GarminStrengthSummary {
  const result: GarminStrengthSummary = { policyVersion: 1, totalRecordedSets: 0, workingSets: 0,
    warmupSets: 0, restMarkers: 0, unknownSets: 0, exerciseCount: 0, exercises: [], complete: true };
  const exercises = new Map<string, number>();
  if (!payloads.length || payloads.length > 100) result.complete = false;
  for (const payload of payloads) {
    const data = record(payload);
    if (!Array.isArray(data.exerciseSets)) { result.complete = false; continue; }
    if (result.totalRecordedSets + data.exerciseSets.length > 2000) { result.complete = false; continue; }
    for (const raw of data.exerciseSets) {
      result.totalRecordedSets++;
      const set = record(raw);
      const kind = typeof set.setType === 'string' ? set.setType.toUpperCase() : '';
      // Explicit Garmin setType only. No reps/weight/duration inference.
      if (kind === 'REST' || kind === 'RECOVERY') result.restMarkers++;
      else if (kind === 'WARMUP' || kind === 'WARM_UP') result.warmupSets++;
      else if (kind === 'ACTIVE' || kind === 'WORK' || kind === 'PERFORMED') result.workingSets++;
      else { result.unknownSets++; result.complete = false; }
      const name = typeof set.exerciseName === 'string' ? set.exerciseName.trim() : null;
      if (name && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name)) {
        exercises.set(name, (exercises.get(name) ?? 0) + (['ACTIVE', 'WORK', 'PERFORMED'].includes(kind) ? 1 : 0));
      }
    }
  }
  if (!result.totalRecordedSets) result.complete = false;
  result.exerciseCount = exercises.size;
  if (exercises.size > 100) result.complete = false;
  result.exercises = [...exercises].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, 100).map(([name, workingSets]) => ({ name, workingSets }));
  return result;
}
export function workoutPointsFromSets(workingSets: number): number {
  if (!Number.isSafeInteger(workingSets) || workingSets < 0 || workingSets > 40000) throw new Error('Invalid working set count.');
  return Math.round(workingSets * 1000 / 3);
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
