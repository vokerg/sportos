import { describe, expect, it } from 'vitest';
import { scoreDay } from './scoring.js';
import type { ScoringRule } from './types.js';

const rules: ScoringRule[] = [
  { code: 'steps.base', name: 'Steps', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 1, enabled: true },
  { code: 'run.km.default', name: 'Run', activityType: 'run', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1000, validFrom: '1900-01-01', priority: 1, enabled: true },
  { code: 'run.5k.sub25.bonus', name: '5k under 25', activityType: 'run', ruleKind: 'achievement', metric: 'duration_s', thresholdOperator: 'lt', thresholdValue: 1500, points: 1000, validFrom: '1900-01-01', priority: 1, enabled: true },
];

describe('scoreDay', () => {
  it('scores deterministic base points and achievement bonuses', () => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 1000, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
      [{ id: 'run1', activityDate: '2026-05-18', activityType: 'run', distanceM: 5000, durationS: 1499 }],
      rules,
    );

    expect(result.totalPoints).toBe(7000);
    expect(result.ledger.map((e) => e.ruleCode)).toContain('run.5k.sub25.bonus');
  });
});
