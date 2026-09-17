import { describe, expect, it } from 'vitest';
import { deductRunningSteps, estimateRunSteps, fallbackRunCadenceSpm, normalizeStravaRunCadenceSpm } from './steps.js';

describe('running step deduction', () => {
  it('normalizes the concrete Strava half-cadence examples', () => {
    expect(normalizeStravaRunCadenceSpm(89.2)).toBe(178.4);
    expect(normalizeStravaRunCadenceSpm(86.2)).toBe(172.4);
    expect(normalizeStravaRunCadenceSpm(93)).toBe(186);
  });

  it('uses measured cadence for every run and subtracts the combined estimate', () => {
    const result = deductRunningSteps(15_000, [
      {
        id: 'fast-10k', activityDate: '2026-09-16', activityType: 'run',
        distanceM: 10_000, movingTimeS: 2_400, avgCadenceSpm: 186,
      },
      {
        id: 'easy-5k', activityDate: '2026-09-16', activityType: 'run',
        distanceM: 5_000, movingTimeS: 1_695, avgCadenceSpm: 172,
      },
    ]);

    expect(result).toMatchObject({
      garminTotalSteps: 15_000,
      estimatedRunningSteps: 12_299,
      nonRunningSteps: 2_701,
      unestimatedRunCount: 0,
    });
    expect(result.runs.map((run) => run.cadenceSource)).toEqual(['strava_cadence', 'strava_cadence']);
  });

  it('uses a gradual pace fallback when cadence is unavailable', () => {
    expect(fallbackRunCadenceSpm(240)).toBe(186);
    expect(fallbackRunCadenceSpm(300)).toBe(178);
    expect(fallbackRunCadenceSpm(339)).toBe(172);
    expect(fallbackRunCadenceSpm(270)).toBe(182);

    expect(estimateRunSteps({
      activityDate: '2026-09-16', activityType: 'run', distanceM: 5_000, movingTimeS: 1_500,
    })).toMatchObject({ cadenceSpm: 178, cadenceSource: 'pace_fallback', estimatedSteps: 4_450 });
  });

  it('never produces negative non-running steps', () => {
    expect(deductRunningSteps(1_000, [{
      activityDate: '2026-09-16', activityType: 'run', movingTimeS: 3_600, avgCadenceSpm: 180,
    }])).toMatchObject({ estimatedRunningSteps: 10_800, nonRunningSteps: 0 });
  });

  it('reports a run that lacks enough timing data instead of inventing steps', () => {
    expect(deductRunningSteps(10_000, [{
      activityDate: '2026-09-16', activityType: 'run', distanceM: 5_000,
    }])).toMatchObject({ estimatedRunningSteps: 0, nonRunningSteps: 10_000, unestimatedRunCount: 1 });
  });
});
