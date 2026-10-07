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

  it('uses exact CSV fallback ahead of imported steps', () => {
    const importedSteps: ActivityFact = {
      activityDate: '2026-09-16', activityType: 'steps', source: 'my_sport_xlsx', steps: 8_000,
    };
    expect(resolveDailySteps({ steps: 8_000 }, [importedSteps, run()], [], [run()], 15_000, null))
      .toMatchObject({ source: 'garmin_adjusted', garminSource: 'csv', resolvedSteps: 6_080 });

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

  it('keeps a legacy nonzero value when Garmin is absent', () => {
    expect(resolveDailySteps({ steps: 7_777 }, [run()], [], [run()], null, null))
      .toEqual({ source: 'stored', resolvedSteps: 7_777 });
  });
});

describe('retained Connect step authority',()=>{
  const connect={steps:15000,sourceVersionId:'v',retainedAt:'2026-10-04T08:00:00Z',latestAttemptAt:'2026-10-06T08:00:00Z',latestAttemptState:'failed'};
  it('Connect replaces imported/stored steps, beats CSV and retains failed attempt metadata',()=>{
    expect(resolveDailySteps({steps:8000},[{activityDate:'2026-10-03',activityType:'steps',source:'my_sport_xlsx',steps:8000}],[],[run()],10000,null,connect))
      .toMatchObject({source:'garmin_adjusted',garminSource:'connect',garminTotalSteps:15000,estimatedRunningSteps:8920,resolvedSteps:6080,sourceVersionId:'v',latestAttemptState:'failed'});
  });
  it('manual positive wins, manual zero unlocks Connect',()=>{
    const manual={activityDate:'2026-10-03',activityType:'steps' as const,source:'manual' as const,steps:1234};
    expect(resolveDailySteps({steps:1234},[],[manual],[run()],10000,null,connect)).toEqual({source:'manual',resolvedSteps:1234});
    expect(resolveDailySteps({steps:0},[],[{...manual,steps:0}],[run()],10000,{stepsCalculation:{source:'none',resolvedSteps:0}},connect)).toMatchObject({garminSource:'connect',resolvedSteps:6080});
  });
  it('reuses pace fallback and keeps unestimated runs auditable',()=>{
    const result=resolveDailySteps(undefined,[],[],[run({avgCadenceSpm:undefined}),run({id:'untimed',movingTimeS:undefined,durationS:undefined})],null,null,connect);
    expect(result.runs?.[0]?.cadenceSource).toBe('pace_fallback');
    expect(result.unestimatedRunCount).toBe(1);
  });
  it('no Garmin preserves imported fallback',()=>{
    expect(resolveDailySteps({steps:8000},[{activityDate:'2026-10-03',activityType:'steps',source:'my_sport_xlsx',steps:8000}],[],[],null,null)).toEqual({source:'imported',resolvedSteps:8000});
  });
});
