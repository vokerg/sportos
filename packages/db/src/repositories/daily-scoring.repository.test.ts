import { describe, expect, it } from 'vitest';
import type { ActivityFact } from '@sportos/domain';
import { resolveDailySteps } from './daily-scoring.repository.js';

const run = (overrides: Partial<ActivityFact> = {}): ActivityFact => ({
  id: 'run-1',
  activityDate: '2026-09-16',
  activityType: 'run',
  source: 'strava',
  distanceM: 10_000,
  movingTimeS: 3_000,
  avgCadenceSpm: 178.4,
  ...overrides,
});

describe('daily step authority', () => {
  it('preserves a positive manual step fact', () => {
    expect(resolveDailySteps(
      { steps: 12_000 },
      [run()],
      [{ activityDate: '2026-09-16', activityType: 'steps', source: 'manual', steps: 12_345 }],
      [run()],
      15_000,
      null,
    )).toEqual({ source: 'manual', resolvedSteps: 12_345 });
  });

  it('preserves imported steps unless a later manual edit explicitly cleared them', () => {
    const importedSteps: ActivityFact = {
      activityDate: '2026-09-16', activityType: 'steps', source: 'my_sport_xlsx', steps: 8_000,
    };
    expect(resolveDailySteps({ steps: 8_000 }, [importedSteps, run()], [], [run()], 15_000, null))
      .toEqual({ source: 'imported', resolvedSteps: 8_000 });

    expect(resolveDailySteps(
      { steps: 0 },
      [importedSteps, run()],
      [],
      [run()],
      15_000,
      { stepsCalculation: { source: 'none', resolvedSteps: 0 } },
    )).toMatchObject({ source: 'garmin_adjusted' });
  });

  it('recomputes a prior Garmin-derived value when run data changes', () => {
    const result = resolveDailySteps(
      { steps: 6_080 },
      [run()],
      [],
      [run()],
      15_000,
      { stepsCalculation: { source: 'garmin_adjusted', resolvedSteps: 6_080 } },
    );

    expect(result).toMatchObject({
      source: 'garmin_adjusted',
      garminTotalSteps: 15_000,
      estimatedRunningSteps: 8_920,
      resolvedSteps: 6_080,
    });
  });

  it('keeps an unattributed legacy nonzero value conservatively', () => {
    expect(resolveDailySteps({ steps: 7_777 }, [run()], [], [run()], 15_000, null))
      .toEqual({ source: 'stored', resolvedSteps: 7_777 });
  });
});
