import { describe, expect, it } from 'vitest';
import { scoreActivityWithRule, scoreDay, scoreFromImportedLedger } from './scoring.js';
import type { ScoringRule } from './types.js';

const rules: ScoringRule[] = [
  { code: 'steps.base', name: 'Steps', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
  { code: 'run.km.default', name: 'Run', activityType: 'run', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1000, validFrom: '1900-01-01', priority: 20, enabled: true },
  { code: 'bonus.manual', name: 'Bonus', activityType: 'bonus', ruleKind: 'manual_points', metric: 'effort_points', coefficient: 1, validFrom: '1900-01-01', priority: 60, enabled: true },
  { code: 'run.pace.per5k.sub5.bonus', name: 'Run rounded pace at or under 5:00/km', activityType: 'run', ruleKind: 'achievement', metric: 'pace_s_per_km', thresholdOperator: 'lte', thresholdValue: 300, thresholdUnit: 's/km', points: 1000, achievementGroup: 'run.pace.per5k', pointsMultiplier: 'rounded_5k_blocks', validFrom: '1900-01-01', priority: 70, enabled: true },
  { code: 'run.pace.per5k.sub4m24.bonus', name: 'Run rounded pace at or under 4:24/km', activityType: 'run', ruleKind: 'achievement', metric: 'pace_s_per_km', thresholdOperator: 'lte', thresholdValue: 264, thresholdUnit: 's/km', points: 2000, achievementGroup: 'run.pace.per5k', pointsMultiplier: 'rounded_5k_blocks', validFrom: '1900-01-01', priority: 71, enabled: true },
  { code: 'run.pace.per5k.sub4m12.bonus', name: 'Run rounded pace at or under 4:12/km', activityType: 'run', ruleKind: 'achievement', metric: 'pace_s_per_km', thresholdOperator: 'lte', thresholdValue: 252, thresholdUnit: 's/km', points: 3000, achievementGroup: 'run.pace.per5k', pointsMultiplier: 'rounded_5k_blocks', validFrom: '1900-01-01', priority: 72, enabled: true },
  { code: 'run.pace.per5k.sub4.bonus', name: 'Run rounded pace at or under 4:00/km', activityType: 'run', ruleKind: 'achievement', metric: 'pace_s_per_km', thresholdOperator: 'lte', thresholdValue: 240, thresholdUnit: 's/km', points: 4000, achievementGroup: 'run.pace.per5k', pointsMultiplier: 'rounded_5k_blocks', validFrom: '1900-01-01', priority: 73, enabled: true },
  { code: 'bike.10k.easy.bonus', name: '10k ride at the 20 km/h boundary', activityType: 'bike', ruleKind: 'achievement', metric: 'avg_speed_kmh', thresholdOperator: 'gte', thresholdValue: 19.9, thresholdUnit: 'kmh', points: 1000, validFrom: '1900-01-01', priority: 100, enabled: true },
];

describe('scoreDay', () => {
  it('keeps an imported workbook ledger total intact without calculated bonuses', () => {
    const result = scoreFromImportedLedger({
      metricDate: '2026-05-18',
      steps: 1000,
      runM: 5000,
      bikeM: 0,
      swimM: 0,
      workoutPoints: 0,
      bonusPoints: 0,
      excelAllPoints: 6000,
    });

    expect(result).toMatchObject({ basePoints: 6000, bonusPoints: 0, totalPoints: 6000 });
    expect(result.ledger).toEqual([{
      metricDate: '2026-05-18',
      points: 6000,
      reason: 'Imported workbook ledger total',
      calculationJson: { scoreStatus: 'imported', source: 'my_sport_xlsx', field: 'All', importedPoints: 6000 },
    }]);
  });

  it('retains the workbook formula inputs alongside an imported total', () => {
    const result = scoreFromImportedLedger(
      {
        metricDate: '2026-05-18',
        steps: 1000,
        runM: 5000,
        bikeM: 0,
        swimM: 0,
        workoutPoints: 0,
        bonusPoints: 0,
        excelAllPoints: 6000,
      },
      {
        allFormula: 'B2+O2',
        formulaInputs: [
          { sourceColumn: 'steps', cellReference: 'B2', value: 1000 },
          { sourceColumn: 'run_to_s', cellReference: 'O2', value: 5000 },
        ],
        formulaIsAdditive: true,
      },
    );

    expect(result.ledger[0]?.calculationJson).toMatchObject({
      workbookFormula: 'B2+O2',
      workbookFormulaInputs: [
        { sourceColumn: 'steps', cellReference: 'B2', value: 1000 },
        { sourceColumn: 'run_to_s', cellReference: 'O2', value: 5000 },
      ],
      workbookFormulaIsAdditive: true,
    });
  });

  it('rejects a fractional or negative imported workbook total instead of changing it silently', () => {
    expect(() => scoreFromImportedLedger({
      metricDate: '2026-05-18', steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0, excelAllPoints: 1.5,
    })).toThrow(/finite, non-negative integer/);
    expect(() => scoreFromImportedLedger({
      metricDate: '2026-05-18', steps: 0, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0, excelAllPoints: -1,
    })).toThrow(/finite, non-negative integer/);
  });

  it('scores deterministic base points and classifies manual and achievement entries as bonuses', () => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 1000, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 250 },
      [{ id: 'run1', activityDate: '2026-05-18', activityType: 'run', distanceM: 5000, durationS: 1499 }],
      rules,
    );

    expect(result).toMatchObject({ basePoints: 6000, bonusPoints: 1250, totalPoints: 7250 });
    expect(result.ledger.map((entry) => entry.ruleCode)).toEqual([
      'steps.base',
      'bonus.manual',
      'run.km.default',
      'run.pace.per5k.sub5.bonus',
    ]);
    expect(result.ledger.find((entry) => entry.ruleCode === 'bonus.manual')?.calculationJson.classification).toBe('bonus');
    expect(result.ledger.find((entry) => entry.ruleCode === 'run.pace.per5k.sub5.bonus')?.calculationJson).toMatchObject({
      classification: 'bonus',
      metricValue: 299.8,
      thresholdOperator: 'lte',
      thresholdValue: 300,
      thresholdUnit: 's/km',
      achievementGroup: 'run.pace.per5k',
      pointsMultiplier: 'rounded_5k_blocks',
      multiplierValue: 1,
      awardedPoints: 1000,
    });
  });

  it('does not combine separate activities into an aggregate achievement', () => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 0, runM: 12_000, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0 },
      [
        { id: 'run1', activityDate: '2026-05-18', activityType: 'run', distanceM: 6000 },
        { id: 'run2', activityDate: '2026-05-18', activityType: 'run', distanceM: 6000 },
      ],
      rules,
    );

    expect(result).toMatchObject({ basePoints: 12_000, bonusPoints: 0, totalPoints: 12_000 });
    expect(result.ledger.map((entry) => entry.ruleCode)).toEqual(['run.km.default', 'run.km.default']);
    expect(result.ledger.map((entry) => entry.activityId)).toEqual(['run1', 'run2']);
  });

  it('uses confirmed subtype coefficients consistently for provider recalculation', () => {
    const result = scoreDay(
      {
        metricDate: '2026-09-13',
        steps: 0,
        runM: 22_032.2,
        runIndoorM: 0,
        runOutdoorM: 22_032.2,
        runUnspecifiedM: 0,
        bikeM: 10_000,
        bikeIndoorM: 0,
        bikeOutdoorM: 10_000,
        bikeUnspecifiedM: 0,
        swimM: 1_000,
        workoutPoints: 0,
        bonusPoints: 0,
      },
      [
        { id: 'strava-run', source: 'strava', activityDate: '2026-09-13', activityType: 'run', subtype: 'outdoor', distanceM: 22_032.2, durationS: 9_203 },
        { id: 'strava-bike', source: 'strava', activityDate: '2026-09-13', activityType: 'bike', subtype: 'outdoor', distanceM: 10_000 },
      ],
      [
        ...rules,
        { code: 'bike.km.default', name: 'Bike', activityType: 'bike', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 650, validFrom: '1900-01-01', priority: 30, enabled: true },
        { code: 'swim.m.default', name: 'Swim', activityType: 'swim', ruleKind: 'coefficient', metric: 'distance_m', coefficient: 7.5, validFrom: '1900-01-01', priority: 40, enabled: true },
      ],
    );

    expect(result).toMatchObject({ basePoints: 50_955, bonusPoints: 0, totalPoints: 50_955 });
    expect(result.ledger.find((entry) => entry.activityId === 'strava-run')).toMatchObject({
      points: 37_455,
      calculationJson: {
        coefficientSource: 'confirmed_workbook_subtype_semantics',
        configuredCoefficient: 1000,
        appliedCoefficient: 1700,
      },
    });
    expect(result.ledger.find((entry) => entry.activityId === 'strava-bike')).toMatchObject({
      points: 6_000,
      calculationJson: {
        coefficientSource: 'confirmed_workbook_subtype_semantics',
        configuredCoefficient: 650,
        appliedCoefficient: 600,
      },
    });
    expect(result.ledger.find((entry) => entry.ruleCode === 'swim.m.default')).toMatchObject({ points: 7_500 });
  });

  it('uses the same subtype coefficients for manual daily facts', () => {
    const result = scoreDay(
      {
        metricDate: '2026-09-13',
        steps: 0,
        runM: 2_000,
        runIndoorM: 1_000,
        runOutdoorM: 1_000,
        runUnspecifiedM: 0,
        bikeM: 2_000,
        bikeIndoorM: 1_000,
        bikeOutdoorM: 1_000,
        bikeUnspecifiedM: 0,
        swimM: 0,
        workoutPoints: 0,
        bonusPoints: 0,
      },
      [],
      [
        ...rules,
        { code: 'bike.km.default', name: 'Bike', activityType: 'bike', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 650, validFrom: '1900-01-01', priority: 30, enabled: true },
      ],
    );

    expect(result).toMatchObject({ basePoints: 4_850, bonusPoints: 0, totalPoints: 4_850 });
    expect(result.ledger.map((entry) => entry.points)).toEqual([1_850, 1_700, 700, 600]);
  });

  it('uses workbook activity-specific coefficients when subtype distances are present', () => {
    const result = scoreDay(
      {
        metricDate: '2026-05-18',
        steps: 0,
        runM: 12_000,
        runIndoorM: 5_000,
        runOutdoorM: 7_000,
        bikeM: 3_000,
        bikeIndoorM: 1_000,
        bikeOutdoorM: 2_000,
        swimM: 0,
        workoutPoints: 0,
        bonusPoints: 0,
      },
      [],
      [
        { code: 'run.km.default', name: 'Legacy run', activityType: 'run', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1000, validFrom: '1900-01-01', priority: 10, enabled: true },
        { code: 'run.km.treadmill', name: 'Treadmill run', activityType: 'run', activitySubtype: 'treadmill', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1850, validFrom: '1900-01-01', priority: 20, enabled: true },
        { code: 'run.km.outdoor', name: 'Outdoor run', activityType: 'run', activitySubtype: 'outdoor', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1700, validFrom: '1900-01-01', priority: 21, enabled: true },
        { code: 'bike.km.default', name: 'Legacy bike', activityType: 'bike', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 650, validFrom: '1900-01-01', priority: 30, enabled: true },
        { code: 'bike.km.indoor', name: 'Indoor bike', activityType: 'bike', activitySubtype: 'indoor', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 700, validFrom: '1900-01-01', priority: 40, enabled: true },
        { code: 'bike.km.outdoor', name: 'Outdoor bike', activityType: 'bike', activitySubtype: 'outdoor', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 600, validFrom: '1900-01-01', priority: 41, enabled: true },
      ],
    );

    expect(result).toMatchObject({ basePoints: 23_050, bonusPoints: 0, totalPoints: 23_050 });
    expect(result.ledger.map((entry) => entry.ruleCode)).toEqual([
      'run.km.treadmill',
      'run.km.outdoor',
      'bike.km.indoor',
      'bike.km.outdoor',
    ]);
  });

  it('scores an unspecified distance remainder with the aggregate rule', () => {
    const result = scoreDay(
      {
        metricDate: '2026-05-18',
        steps: 0,
        runM: 10_000,
        runIndoorM: 2_000,
        runOutdoorM: 3_000,
        runUnspecifiedM: 5_000,
        bikeM: 0,
        swimM: 0,
        workoutPoints: 0,
        bonusPoints: 0,
      },
      [],
      [
        { code: 'run.km.default', name: 'Legacy run', activityType: 'run', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1000, validFrom: '1900-01-01', priority: 10, enabled: true },
        { code: 'run.km.treadmill', name: 'Treadmill run', activityType: 'run', activitySubtype: 'treadmill', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1850, validFrom: '1900-01-01', priority: 20, enabled: true },
        { code: 'run.km.outdoor', name: 'Outdoor run', activityType: 'run', activitySubtype: 'outdoor', ruleKind: 'coefficient', metric: 'distance_km', coefficient: 1700, validFrom: '1900-01-01', priority: 21, enabled: true },
      ],
    );

    expect(result).toMatchObject({ basePoints: 13_800, totalPoints: 13_800 });
    expect(result.ledger.map((entry) => entry.ruleCode)).toEqual([
      'run.km.treadmill',
      'run.km.outdoor',
      'run.km.default',
    ]);
    expect(result.ledger.find((entry) => entry.ruleCode === 'run.km.default')?.calculationJson).toMatchObject({
      metricValue: 5,
    });
  });

  it('uses rule code as a deterministic tie-breaker when priorities match', () => {
    const tiedRules: ScoringRule[] = [
      { code: 'steps.z', name: 'Z', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
      { code: 'steps.a', name: 'A', activityType: 'steps', ruleKind: 'coefficient', metric: 'steps', coefficient: 1, validFrom: '1900-01-01', priority: 10, enabled: true },
    ];

    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 1, runM: 0, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0 },
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

  it('rounds close run distance and pace in favour of bonus eligibility', () => {
    const rule = rules.find((candidate) => candidate.code === 'run.pace.per5k.sub5.bonus')!;

    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 0, runM: 4980, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0 },
      [{ activityDate: '2026-05-18', activityType: 'run', distanceM: 4980, durationS: 1198 }],
      rules,
    );
    const entry = result.ledger.find((candidate) => candidate.calculationJson.ruleKind === 'achievement');

    expect(entry).toMatchObject({ ruleCode: 'run.pace.per5k.sub4.bonus', points: 4000 });
    expect(entry?.calculationJson).toMatchObject({
      thresholdComparisonValue: 240,
      multiplierInputValue: 5000,
      multiplierValue: 1,
      eligibilityRounding: 'nearest_0.1_km_and_0.1_min_per_km_favouring_boundary',
    });
    expect(scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'run', distanceM: 4949, durationS: 1000 },
      rule,
      '2026-05-18',
    )).toBeNull();
    expect(scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'run', distanceM: 5000, durationS: 1515 },
      rule,
      '2026-05-18',
    )).toBeNull();
  });

  it('preserves the strict semantics of historical completed-5k rule versions', () => {
    const roundedRule = rules.find((candidate) => candidate.code === 'run.pace.per5k.sub5.bonus')!;
    const historicalRule = { ...roundedRule, thresholdOperator: 'lt' as const, pointsMultiplier: 'completed_5k_blocks' as const };

    expect(scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'run', distanceM: 4999, durationS: 1000 },
      historicalRule,
      '2026-05-18',
    )).toBeNull();
    expect(scoreActivityWithRule(
      { activityDate: '2026-05-18', activityType: 'run', distanceM: 5000, durationS: 1500 },
      historicalRule,
      '2026-05-18',
    )).toBeNull();
  });

  it('awards only the highest pace tier and scales it by completed 5 km blocks', () => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 0, runM: 17_000, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0 },
      [{ id: 'run17', activityDate: '2026-05-18', activityType: 'run', distanceM: 17_000, durationS: 4_079 }],
      rules,
    );

    const achievements = result.ledger.filter((entry) => entry.calculationJson.ruleKind === 'achievement');
    expect(achievements).toHaveLength(1);
    expect(achievements[0]).toMatchObject({
      ruleCode: 'run.pace.per5k.sub4.bonus',
      points: 12_000,
      calculationJson: { configuredPoints: 4000, multiplierValue: 3, awardedPoints: 12_000 },
    });
  });

  it.each([
    { durationS: 1515, expectedCode: undefined, expectedPoints: 0 },
    { durationS: 1500, expectedCode: 'run.pace.per5k.sub5.bonus', expectedPoints: 1000 },
    { durationS: 1320, expectedCode: 'run.pace.per5k.sub4m24.bonus', expectedPoints: 2000 },
    { durationS: 1260, expectedCode: 'run.pace.per5k.sub4m12.bonus', expectedPoints: 3000 },
    { durationS: 1200, expectedCode: 'run.pace.per5k.sub4.bonus', expectedPoints: 4000 },
  ])('qualifies the favourably rounded $durationS-second 5k cutoff', ({ durationS, expectedCode, expectedPoints }) => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 0, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0 },
      [{ id: 'boundary-run', activityDate: '2026-05-18', activityType: 'run', distanceM: 5000, durationS }],
      rules,
    );

    const achievements = result.ledger.filter((entry) => entry.calculationJson.ruleKind === 'achievement');
    expect(achievements.map((entry) => entry.ruleCode)).toEqual(expectedCode ? [expectedCode] : []);
    expect(result.bonusPoints).toBe(expectedPoints);
  });

  it('counts completed 5 km blocks independently for each run', () => {
    const result = scoreDay(
      { metricDate: '2026-05-18', steps: 0, runM: 16_000, bikeM: 0, swimM: 0, workoutPoints: 0, bonusPoints: 0 },
      [
        { id: 'fast-run-1', activityDate: '2026-05-18', activityType: 'run', distanceM: 8000, durationS: 1919 },
        { id: 'fast-run-2', activityDate: '2026-05-18', activityType: 'run', distanceM: 8000, durationS: 1919 },
      ],
      rules,
    );

    const achievements = result.ledger.filter((entry) => entry.calculationJson.ruleKind === 'achievement');
    expect(achievements).toHaveLength(2);
    expect(achievements.map((entry) => entry.points)).toEqual([4000, 4000]);
    expect(achievements.map((entry) => entry.calculationJson.multiplierValue)).toEqual([1, 1]);
    expect(result.bonusPoints).toBe(8000);
  });

  it('awards the bike bonus within 0.1 km/h of 20 and uses distance as an auxiliary condition', () => {
    const rule = rules.find((candidate) => candidate.code === 'bike.10k.easy.bonus')!;

    const qualifying = scoreActivityWithRule(
      { activityDate: '2026-09-08', activityType: 'bike', subtype: 'outdoor', distanceM: 12_023.3, avgSpeedMps: 6.217 },
      rule,
      '2026-09-08',
    );
    expect(qualifying?.points).toBe(1000);
    expect(qualifying?.calculationJson).toMatchObject({
      metric: 'avg_speed_kmh',
      metricValue: 22.3812,
      thresholdOperator: 'gte',
      auxiliaryConditions: [
        { metric: 'distance_m', operator: 'gte', expected: 10_000, actual: 12_023.3, passed: true },
      ],
    });

    expect(scoreActivityWithRule(
      { activityDate: '2026-09-08', activityType: 'bike', distanceM: 9_999.9, avgSpeedMps: 6.217 },
      rule,
      '2026-09-08',
    )).toBeNull();
    expect(scoreActivityWithRule(
      { activityDate: '2026-09-08', activityType: 'bike', distanceM: 10_440, avgSpeedMps: 19.92 / 3.6 },
      rule,
      '2026-09-08',
    )?.points).toBe(1000);
    expect(scoreActivityWithRule(
      { activityDate: '2026-09-08', activityType: 'bike', distanceM: 12_023.3, avgSpeedMps: 19.89 / 3.6 },
      rule,
      '2026-09-08',
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
