import type { ActivityFact } from './types.js';

export type RunCadenceSource = 'strava_cadence' | 'pace_fallback';

export interface RunStepEstimate {
  activityId?: string;
  distanceM?: number;
  movingTimeS: number;
  paceSPerKm?: number;
  cadenceSpm: number;
  cadenceSource: RunCadenceSource;
  estimatedSteps: number;
}

export interface GarminStepDeduction {
  garminTotalSteps: number;
  estimatedRunningSteps: number;
  nonRunningSteps: number;
  runs: RunStepEstimate[];
  unestimatedRunCount: number;
}

const MIN_FALLBACK_CADENCE_SPM = 150;
const MAX_FALLBACK_CADENCE_SPM = 200;

/**
 * Resolves Garmin's all-day step total into the non-running steps that may be
 * scored alongside separately scored run distance.
 */
export function deductRunningSteps(
  garminTotalSteps: number,
  activities: ActivityFact[],
): GarminStepDeduction {
  const total = nonNegativeInteger(garminTotalSteps);
  const runs: RunStepEstimate[] = [];
  let unestimatedRunCount = 0;

  for (const activity of activities) {
    if (activity.activityType !== 'run') continue;
    const estimate = estimateRunSteps(activity);
    if (estimate) runs.push(estimate);
    else unestimatedRunCount += 1;
  }

  const estimatedRunningSteps = runs.reduce((sum, run) => sum + run.estimatedSteps, 0);
  return {
    garminTotalSteps: total,
    estimatedRunningSteps,
    nonRunningSteps: Math.max(total - estimatedRunningSteps, 0),
    runs,
    unestimatedRunCount,
  };
}

export function estimateRunSteps(activity: ActivityFact): RunStepEstimate | null {
  if (activity.activityType !== 'run') return null;

  const distanceM = positive(activity.distanceM);
  const suppliedPace = positive(activity.avgPaceSPerKm);
  const movingTimeS = positive(activity.movingTimeS)
    ?? positive(activity.durationS)
    ?? (distanceM !== undefined && suppliedPace !== undefined
      ? suppliedPace * (distanceM / 1000)
      : undefined);
  if (movingTimeS === undefined) return null;

  const paceSPerKm = suppliedPace
    ?? (distanceM === undefined ? undefined : movingTimeS / (distanceM / 1000));
  const measuredCadence = plausibleRunningCadence(activity.avgCadenceSpm);
  const cadenceSpm = measuredCadence ?? (paceSPerKm === undefined ? undefined : fallbackRunCadenceSpm(paceSPerKm));
  if (cadenceSpm === undefined) return null;

  return {
    ...(activity.id ? { activityId: activity.id } : {}),
    ...(distanceM === undefined ? {} : { distanceM }),
    movingTimeS,
    ...(paceSPerKm === undefined ? {} : { paceSPerKm }),
    cadenceSpm,
    cadenceSource: measuredCadence === undefined ? 'pace_fallback' : 'strava_cadence',
    estimatedSteps: Math.max(0, Math.round(cadenceSpm * movingTimeS / 60)),
  };
}

/**
 * Pace-based fallback calibrated to the user's measured examples:
 * 4:00/km -> 186 spm, 5:00/km -> 178 spm, 5:39/km -> 172 spm.
 * Values between anchors are interpolated; edge segments are extrapolated and
 * bounded to a realistic running range.
 */
export function fallbackRunCadenceSpm(paceSPerKm: number): number {
  const pace = positive(paceSPerKm);
  if (pace === undefined) throw new TypeError('Running pace must be positive.');

  const cadence = pace <= 300
    ? interpolate(pace, 240, 186, 300, 178)
    : interpolate(pace, 300, 178, 339, 172);
  return roundToOne(Math.min(MAX_FALLBACK_CADENCE_SPM, Math.max(MIN_FALLBACK_CADENCE_SPM, cadence)));
}

/** Normalizes Strava's one-foot running cadence to total steps per minute. */
export function normalizeStravaRunCadenceSpm(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const stepsPerMinute = value < 130 ? value * 2 : value;
  return stepsPerMinute >= 80 && stepsPerMinute <= 260 ? roundToOne(stepsPerMinute) : undefined;
}

function plausibleRunningCadence(value: number | undefined): number | undefined {
  const cadence = positive(value);
  return cadence !== undefined && cadence >= 80 && cadence <= 260 ? roundToOne(cadence) : undefined;
}

function interpolate(value: number, x1: number, y1: number, x2: number, y2: number): number {
  return y1 + ((value - x1) * (y2 - y1)) / (x2 - x1);
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError('Garmin steps must be non-negative.');
  return Math.round(value);
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}
