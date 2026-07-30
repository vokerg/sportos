import { describe, expect, it } from 'vitest';
import { reconcileScore, reconcileScores } from './reconciliation.js';
import type { ScoringRule } from './types.js';

const baseRules: ScoringRule[] = [
  { code: 'steps.base', name: 'Steps', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
  { code: 'run.km.default', name: 'Run', activityType: 'run', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1000, validFrom: '1900-01-01', priority: 20, enabled: true },
  { code: 'bike.km.default', name: 'Bike', activityType: 'bike', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 650, validFrom: '1900-01-01', priority: 30, enabled: true },
  { code: 'run.5k.sub25.bonus', name: '5k under 25', activityType: 'run', ruleKind: 'achievement', metric: 'duration_s', thresholdOperator: 'lt', thresholdValue: 1500, thresholdUnit: 's', points: 1000, validFrom: '1900-01-01', priority: 70, enabled: true },
];

describe('reconcileScore', () => {
  it('identifies an exact total and exact formula component', () => {
    const row = reconcileScore({
      facts: { metricDate: '2026-05-18', steps: 1000, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0, excelAllPoints: 6000 },
      activities: [],
      rules: baseRules,
      sourceComponents: [{ activityType: 'run', sourceColumn: 'run_to_s', importedPoints: 5000 }],
    });

    expect(row).toMatchObject({
      date: '2026-05-18',
      appTotal: 6000,
      excelTotal: 6000,
      delta: 0,
      status: 'exact',
      explanationCode: 'exact_total',
    });
    expect(row.componentResults).toEqual([
      {
        activityType: 'run',
        sourceColumn: 'run_to_s',
        importedPoints: 5000,
        appBasePoints: 5000,
        delta: 0,
        tolerance: 0,
        status: 'exact',
        ruleCodes: ['run.km.default'],
      },
    ]);
  });

  it('explains a delta that is exactly the SportOS bonus excluded from Excel', () => {
    const row = reconcileScore({
      facts: { metricDate: '2026-05-19', steps: 1000, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0, excelAllPoints: 6000 },
      activities: [{ activityDate: '2026-05-19', activityType: 'run', distanceM: 5000, durationS: 1499 }],
      rules: baseRules,
    });

    expect(row).toMatchObject({
      appTotal: 7000,
      excelTotal: 6000,
      delta: 1000,
      status: 'explained',
      explanationCode: 'sportos_bonus_excluded_from_excel',
      likelyRuleCodes: ['run.5k.sub25.bonus'],
    });
  });

  it('uses tolerance only when an explicit lossy source rounding unit is supplied', () => {
    const roundingRule: ScoringRule = {
      code: 'steps.rounding',
      name: 'Rounding example',
      activityType: 'steps',
      ruleKind: 'coefficient',
      metric: 'steps',
      coefficient: 1.2,
      validFrom: '1900-01-01',
      priority: 1,
      enabled: true,
    };
    const input = {
      facts: { metricDate: '2026-05-20', steps: 1, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0, excelAllPoints: 1.4 },
      activities: [],
      rules: [roundingRule],
    };

    expect(reconcileScore(input)).toMatchObject({ status: 'unresolved', tolerance: 0 });
    expect(reconcileScore({ ...input, sourceRoundingUnit: 1 })).toMatchObject({
      status: 'explained',
      explanationCode: 'source_rounding_tolerance',
      tolerance: 0.5,
      likelyRuleCodes: ['steps.rounding'],
    });
  });

  it('keeps mismatches unresolved and identifies only evidence-backed candidate rules', () => {
    const row = reconcileScore({
      facts: { metricDate: '2026-05-21', steps: 0, runM: 0, bikeM: 1000, swimM: 0, workoutPoints: 0, powerPoints: 0, excelAllPoints: 700 },
      activities: [],
      rules: baseRules,
      sourceComponents: [
        { activityType: 'bike', sourceColumn: 'bike_to_s', importedPoints: 700 },
        { activityType: 'sup', sourceColumn: 'sup_to_s', importedPoints: 100 },
      ],
    });

    expect(row).toMatchObject({
      appTotal: 650,
      excelTotal: 700,
      delta: -50,
      status: 'unresolved',
      explanationCode: 'unresolved_delta',
      likelyRuleCodes: ['bike.km.default'],
    });
    expect(row.componentResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceColumn: 'bike_to_s', status: 'mismatch', ruleCodes: ['bike.km.default'] }),
      expect.objectContaining({ sourceColumn: 'sup_to_s', status: 'unmapped', ruleCodes: [] }),
    ]));
  });
});

describe('reconcileScores', () => {
  it('produces deterministic status, magnitude, activity, and likely-rule groups', () => {
    const summary = reconcileScores([
      {
        facts: { metricDate: '2026-05-22', steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
        activities: [],
        rules: baseRules,
      },
      {
        facts: { metricDate: '2026-05-18', steps: 1000, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0, excelAllPoints: 6000 },
        activities: [],
        rules: baseRules,
      },
    ]);

    expect(summary.policy).toEqual({
      defaultTolerance: 0,
      roundingToleranceRequiresExplicitSourceUnit: true,
      bonusClassification: 'achievement_or_power_bonus',
      coefficientRounding: 'nearest_integer_per_rule',
    });
    expect(summary.counts).toEqual({ exact: 1, explained: 0, unresolved: 0, not_comparable: 1 });
    expect(summary.rows.map((row) => row.date)).toEqual(['2026-05-18', '2026-05-22']);
    expect(summary.groups.byStatus).toEqual([
      { key: 'exact', count: 1, dates: ['2026-05-18'] },
      { key: 'not_comparable', count: 1, dates: ['2026-05-22'] },
    ]);
    expect(summary.groups.byMagnitude).toEqual([
      { key: 'exact', count: 1, dates: ['2026-05-18'] },
      { key: 'not_comparable', count: 1, dates: ['2026-05-22'] },
    ]);
  });
});
