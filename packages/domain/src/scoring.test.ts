import { describe, expect, it } from 'vitest';
import { scoreActivityWithRule, scoreDay } from './scoring.js';
import type { ScoringRule } from './types.js';

const rules: ScoringRule[] = [
  { code: 'steps.base', name: 'Steps', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
  { code: 'run.km.default', name: 'Run', activityType: 'run', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1000, validFrom: '1900-01-01', priority: 20, enabled: true },
  { code: 'power.manual', name: 'Power', activityType: 'power_bonus', ruleKind: 'manual_points', metric: 'effort_points', coefficient: 1, validFrom: '1900-01-01', priority: 60, enabled: true },
  { code: 'run.5k.sub25.bonus', name: '5k under 25', activityType: 'run', ruleKind: 'achievement', metric: 'duration_s', thresholdOperator: 'lt', thresholdValue: 1500, thresholdUnit: 's', points: 1000, validFrom: '1900-01-01', priority: 70, enabled: true },
  { code: 'run.10k.completed.bonus', name: '10k completed', activityType: 'run', ruleKind: 'achievement', metric: 'distance_m', thresholdOperator: 'gte', thresholdValue: 10000, thresholdUnit: 'm', points: 2000, validFrom: '1900-01-01', priority: 80, enabled: true },
];

describe('scoreDay', () => {
  it('scores deterministic base points and classifies power and achievement entries as bonuses', () => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 1000, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 250 },
      [{ id: 'run1', activityDate: '2026-05-18', activityType: 'run', distanceM: 5000, durationS: 1499 }],
      rules,
    );

    expect(result).toMatchObject({ basePoints: 6000, bonusPoints: 1250, totalPoints: 7250 });
    expect(result.ledger.map((entry) => entry.ruleCode)).toEqual([
      'steps.base',
      'run.km.default',
      'power.manual',
      'run.5k.sub25.bonus',
    ]);
    expect(result.ledger.find((entry) => entry.ruleCode === 'power.manual')?.calculationJson.classification).toBe('bonus');
    expect(result.ledger.find((entry) => entry.ruleCode === 'run.5k.sub25.bonus')?.calculationJson).toMatchObject({
      classification: 'bonus',
      metricValue: 1499,
      thresholdOperator: 'lt',
      thresholdValue: 1500,
      thresholdUnit: 's',
      auxiliaryConditions: [
        { metric: 'distance_m', operator: 'within', expected: 5000, actual: 5000, passed: true },
      ],
    });
  });

  it('does not combine separate activities into an aggregate achievement', () => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 0, runM: 12_000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
      [
        { id: 'run1', activityDate: '2026-05-18', activityType: 'run', distanceM: 6000 },
        { id: 'run2', activityDate: '2026-05-18', activityType: 'run', distanceM: 6000 },
      ],
      rules,
    );

    expect(result).toMatchObject({ basePoints: 12_000, bonusPoints: 0, totalPoints: 12_000 });
    expect(result.ledger.map((entry) => entry.ruleCode)).toEqual(['run.km.default']);
  });

  it('uses rule code as a deterministic tie-breaker when priorities match', () => {
    const tiedRules: ScoringRule[] = [
      { code: 'steps.z', name: 'Z', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
      { code: 'steps.a', name: 'A', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
    ];

    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 1, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
      [],
      tiedRules,
    );

    expect(result.ledger.map((entry) => entry.ruleCode)).toEqual(['steps.a', 'steps.z']);
  });
});

describe('scoreActivityWithRule', () => {
  it('rounds once per rule and records raw and rounded calculation inputs', () => {
    const rule: ScoringRule = {
      code: 'bike.test',
      name: 'Bike test',
      activityType: 'bike',
      ruleKind: 'coefficient',
      metric: 'distance_km',
      coefficient: 650.5,
      validFrom: '2026-01-01',
      priority: 1,
      enabled: true,
    };

    const entry = scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'bike', distanceM: 1000 },
      rule,
      '2026-05-18',
    );

    expect(entry).toMatchObject({ points: 651 });
    expect(entry?.calculationJson).toMatchObject({
      metric: 'distance_km',
      metricUnit: 'km',
      metricValue: 1,
      coefficient: 650.5,
      rawPoints: 650.5,
      rounding: 'nearest_integer_per_rule',
      roundedPoints: 651,
      validFrom: '2026-01-01',
      validTo: null,
    });
  });

  it('uses strict threshold boundaries and the documented 5k distance window', () => {
    const rule = rules.find((candidate) => candidate.code === 'run.5k.sub25.bonus')!;

    expect(scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'run', distanceM: 5500, durationS: 1499 },
      rule,
      '2026-05-18',
    )?.points).toBe(1000);
    expect(scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'run', distanceM: 5500, durationS: 1500 },
      rule,
      '2026-05-18',
    )).toBeNull();
    expect(scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'run', distanceM: 5501, durationS: 1499 },
      rule,
      '2026-05-18',
    )).toBeNull();
  });

  it('applies valid-from and valid-to dates inclusively', () => {
    const rule: ScoringRule = {
      code: 'steps.january',
      name: 'January steps',
      activityType: 'steps',
      ruleKind: 'coefficient',
      metric: 'steps',
      coefficient: 1,
      validFrom: '2026-01-01',
      validTo: '2026-01-31',
      priority: 1,
      enabled: true,
    };
    const activity = { activityDate: '2026-01-01', activityType: 'steps' as const, steps: 1 };

    expect(scoreActivityWithRule(activity, rule, '2025-12-31')).toBeNull();
    expect(scoreActivityWithRule(activity, rule, '2026-01-01')?.points).toBe(1);
    expect(scoreActivityWithRule(activity, rule, '2026-01-31')?.points).toBe(1);
    expect(scoreActivityWithRule(activity, rule, '2026-02-01')).toBeNull();
  });
});
