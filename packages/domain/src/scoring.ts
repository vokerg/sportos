import type {
  ActivityFact,
  DailyMetricFacts,
  DailyScoreResult,
  ImportedLedgerEvidence,
  ScoringRule,
  ScoreLedgerEntry,
} from './types.js';
import { metersToKm, mpsToKmh } from './units.js';

const ROUNDING_POLICY = 'nearest_integer_per_rule';
const RUN_BONUS_DISTANCE_INCREMENT_M = 100;
const RUN_BONUS_PACE_INCREMENT_S_PER_KM = 6;
const RUN_BONUS_ELIGIBILITY_ROUNDING = 'nearest_0.1_km_and_0.1_min_per_km_favouring_boundary';

export function scoreFromImportedLedger(facts: DailyMetricFacts, evidence?: ImportedLedgerEvidence): DailyScoreResult {
  const importedPoints = facts.excelAllPoints;
  if (importedPoints === undefined || !Number.isFinite(importedPoints) || !Number.isInteger(importedPoints) || importedPoints < 0) {
    throw new Error('Imported workbook All must be a finite, non-negative integer.');
  }

  const calculationJson: Record<string, unknown> = {
    scoreStatus: 'imported',
    source: 'my_sport_xlsx',
    field: 'All',
    importedPoints,
  };
  if (evidence?.allFormula) calculationJson.workbookFormula = evidence.allFormula;
  if (evidence?.formulaInputs && evidence.formulaInputs.length > 0) {
    calculationJson.workbookFormulaInputs = evidence.formulaInputs;
  }
  if (evidence?.formulaIsAdditive !== undefined) {
    calculationJson.workbookFormulaIsAdditive = evidence.formulaIsAdditive;
  }

  return {
    metricDate: facts.metricDate,
    basePoints: importedPoints,
    bonusPoints: 0,
    totalPoints: importedPoints,
    ledger: importedPoints === 0 ? [] : [{
      metricDate: facts.metricDate,
      points: importedPoints,
      reason: 'Imported workbook ledger total',
      calculationJson,
    }],
  };
}

export function scoreDay(facts: DailyMetricFacts, activities: ActivityFact[], rules: ScoringRule[]): DailyScoreResult {
  const activeRules = rules
    .filter((rule) => rule.enabled && isRuleActiveForDate(rule, facts.metricDate))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));

  const ledger: ScoreLedgerEntry[] = [];
  const datedActivities = activities.filter((candidate) => candidate.activityDate === facts.metricDate);
  const distanceActivities = datedActivities.filter(
    (candidate) => candidate.activityType === 'run' || candidate.activityType === 'bike',
  );
  const activityBackedTypes = new Set(
    (['run', 'bike'] as const).filter((activityType) => activityDistancesMatchAggregate(distanceActivities, activityType, facts)),
  );
  const allowConfirmedSubtypeSplits = facts.excelAllPoints === undefined;

  const syntheticDailyActivities = ([
    { activityDate: facts.metricDate, activityType: 'steps', steps: facts.steps },
    ...splitDistanceActivities(
      facts,
      'run',
      facts.runM,
      facts.runIndoorM,
      facts.runOutdoorM,
      facts.runUnspecifiedM,
      allowConfirmedSubtypeSplits || hasSubtypeRules(activeRules, 'run'),
    ),
    ...splitDistanceActivities(
      facts,
      'bike',
      facts.bikeM,
      facts.bikeIndoorM,
      facts.bikeOutdoorM,
      facts.bikeUnspecifiedM,
      allowConfirmedSubtypeSplits || hasSubtypeRules(activeRules, 'bike'),
    ),
    { activityDate: facts.metricDate, activityType: 'swim', distanceM: facts.swimM },
    { activityDate: facts.metricDate, activityType: 'workout', effortPoints: facts.workoutPoints },
    { activityDate: facts.metricDate, activityType: 'power_bonus', effortPoints: facts.powerPoints },
  ] as ActivityFact[]).filter((activity) => !activityBackedTypes.has(activity.activityType as 'run' | 'bike'));

  // Daily aggregates drive coefficient/manual rules only. Achievement rules must
  // evaluate one canonical activity so separate sessions are never combined into
  // a synthetic threshold achievement.
  for (const activity of syntheticDailyActivities) {
    for (const rule of activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType
        && candidate.ruleKind !== 'achievement'
        && syntheticRuleApplies(candidate, activity, facts, activeRules),
    )) {
      const entry = scoreActivityWithConfirmedSubtypeCoefficient(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
  }

  for (const activity of distanceActivities) {
    if (!activityBackedTypes.has(activity.activityType as 'run' | 'bike')) continue;
    for (const rule of activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType
        && candidate.ruleKind !== 'achievement'
        && activityRuleApplies(candidate, activity, activeRules),
    )) {
      const entry = scoreActivityWithConfirmedSubtypeCoefficient(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
  }

  for (const activity of datedActivities) {
    const achievementCandidates = activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType
        && candidate.ruleKind === 'achievement'
        && (!candidate.activitySubtype || candidate.activitySubtype === activity.subtype),
    ).map((rule) => ({ rule, entry: scoreActivityWithRule(activity, rule, facts.metricDate) }))
      .filter((candidate): candidate is { rule: ScoringRule; entry: ScoreLedgerEntry } => candidate.entry !== null);
    const groupedAchievements = new Map<string, { rule: ScoringRule; entry: ScoreLedgerEntry }>();

    for (const candidate of achievementCandidates) {
      const group = candidate.rule.achievementGroup;
      if (!group) {
        ledger.push(candidate.entry);
        continue;
      }
      const selected = groupedAchievements.get(group);
      if (!selected || achievementCandidatePrecedes(candidate, selected)) groupedAchievements.set(group, candidate);
    }
    for (const { entry } of groupedAchievements.values()) ledger.push(entry);
  }

  function achievementCandidatePrecedes(
    candidate: { rule: ScoringRule; entry: ScoreLedgerEntry },
    selected: { rule: ScoringRule; entry: ScoreLedgerEntry },
  ): boolean {
    const pointDifference = (candidate.rule.points ?? 0) - (selected.rule.points ?? 0);
    if (pointDifference !== 0) return pointDifference > 0;
    if (candidate.rule.priority !== selected.rule.priority) return candidate.rule.priority < selected.rule.priority;
    return candidate.rule.code.localeCompare(selected.rule.code) < 0;
  }

  const basePoints = ledger
    .filter((entry) => entry.calculationJson.classification === 'base')
    .reduce((sum, entry) => sum + entry.points, 0);
  const bonusPoints = ledger
    .filter((entry) => entry.calculationJson.classification === 'bonus')
    .reduce((sum, entry) => sum + entry.points, 0);

  return {
    metricDate: facts.metricDate,
    basePoints,
    bonusPoints,
    totalPoints: basePoints + bonusPoints,
    ledger,
  };
}

export function scoreActivityWithRule(activity: ActivityFact, rule: ScoringRule, metricDate: string): ScoreLedgerEntry | null {
  if (!rule.enabled || !isRuleActiveForDate(rule, metricDate)) return null;
  if (rule.activitySubtype && rule.activitySubtype !== activity.subtype) return null;

  const classification = classifyRule(rule);

  if (rule.ruleKind === 'coefficient') {
    const metricValue = getMetricValue(activity, rule.metric);
    if (metricValue === undefined || rule.coefficient === undefined) return null;
    const rawPoints = metricValue * rule.coefficient;
    const points = Math.round(rawPoints);
    if (points === 0) return null;
    return {
      metricDate,
      activityId: activity.id,
      ruleId: rule.id,
      ruleCode: rule.code,
      points,
      reason: `${rule.name}: round(${metricValue} ${metricUnit(rule.metric)} × ${rule.coefficient}) = ${points}`,
      calculationJson: {
        ruleKind: rule.ruleKind,
        classification,
        activityType: rule.activityType,
        metric: rule.metric,
        metricUnit: metricUnit(rule.metric),
        metricValue,
        coefficient: rule.coefficient,
        rawPoints,
        rounding: ROUNDING_POLICY,
        roundedPoints: points,
        validFrom: rule.validFrom,
        validTo: rule.validTo ?? null,
        priority: rule.priority,
      },
    };
  }

  if (rule.ruleKind === 'manual_points') {
    const metricValue = getMetricValue(activity, rule.metric) ?? 0;
    const multiplier = rule.coefficient ?? 1;
    const rawPoints = metricValue * multiplier;
    const points = Math.round(rawPoints);
    if (points === 0) return null;
    return {
      metricDate,
      activityId: activity.id,
      ruleId: rule.id,
      ruleCode: rule.code,
      points,
      reason: `${rule.name}: round(${metricValue} ${metricUnit(rule.metric)} × ${multiplier}) = ${points}`,
      calculationJson: {
        ruleKind: rule.ruleKind,
        classification,
        activityType: rule.activityType,
        metric: rule.metric,
        metricUnit: metricUnit(rule.metric),
        metricValue,
        multiplier,
        rawPoints,
        rounding: ROUNDING_POLICY,
        roundedPoints: points,
        validFrom: rule.validFrom,
        validTo: rule.validTo ?? null,
        priority: rule.priority,
      },
    };
  }

  if (rule.ruleKind === 'achievement') {
    const metricValue = getMetricValue(activity, rule.metric);
    const thresholdEvaluation = evaluateThresholdValue(metricValue, rule);
    if (!thresholdEvaluation.passed) return null;
    const auxiliaryConditions = achievementAuxiliaryConditions(activity, rule);
    if (auxiliaryConditions.some((condition) => !condition.passed)) return null;
    const configuredPoints = rule.points ?? 0;
    const multiplierEvaluation = achievementPointsMultiplier(activity, rule);
    if (multiplierEvaluation.value === 0) return null;
    const points = configuredPoints * multiplierEvaluation.value;
    if (points === 0) return null;
    const multiplierExplanation = rule.pointsMultiplier === 'completed_5k_blocks' || rule.pointsMultiplier === 'rounded_5k_blocks'
      ? `; ${multiplierEvaluation.value} completed 5 km block${multiplierEvaluation.value === 1 ? '' : 's'} × ${configuredPoints} = ${points}`
      : `; +${points}`;
    return {
      metricDate,
      activityId: activity.id,
      ruleId: rule.id,
      ruleCode: rule.code,
      points,
      reason: `${rule.name}: ${formatThreshold(metricValue, rule, thresholdEvaluation)}${multiplierExplanation}`,
      calculationJson: {
        ruleKind: rule.ruleKind,
        classification,
        activityType: rule.activityType,
        metric: rule.metric,
        metricUnit: metricUnit(rule.metric),
        metricValue: metricValue ?? null,
        thresholdOperator: rule.thresholdOperator ?? null,
        thresholdValue: rule.thresholdValue ?? null,
        thresholdUnit: rule.thresholdUnit ?? null,
        thresholdComparisonValue: thresholdEvaluation.comparisonValue ?? null,
        eligibilityRounding: thresholdEvaluation.roundingPolicy ?? multiplierEvaluation.roundingPolicy ?? null,
        configuredPoints,
        achievementGroup: rule.achievementGroup ?? null,
        pointsMultiplier: rule.pointsMultiplier ?? null,
        multiplierValue: multiplierEvaluation.value,
        multiplierInputValue: multiplierEvaluation.inputValue ?? null,
        awardedPoints: points,
        auxiliaryConditions,
        validFrom: rule.validFrom,
        validTo: rule.validTo ?? null,
        priority: rule.priority,
      },
    };
  }

  return null;
}

function achievementPointsMultiplier(
  activity: ActivityFact,
  rule: ScoringRule,
): { value: number; inputValue?: number; roundingPolicy?: string } {
  if (!rule.pointsMultiplier) return { value: 1 };
  if (rule.pointsMultiplier === 'completed_5k_blocks') {
    return { value: Math.floor((activity.distanceM ?? 0) / 5000), inputValue: activity.distanceM ?? 0 };
  }
  if (rule.pointsMultiplier === 'rounded_5k_blocks') {
    const roundedDistanceM = roundToIncrement(activity.distanceM ?? 0, RUN_BONUS_DISTANCE_INCREMENT_M);
    return {
      value: Math.floor(roundedDistanceM / 5000),
      inputValue: roundedDistanceM,
      roundingPolicy: RUN_BONUS_ELIGIBILITY_ROUNDING,
    };
  }
  return { value: 0 };
}

export function isRuleActiveForDate(rule: ScoringRule, isoDate: string): boolean {
  return rule.validFrom <= isoDate && (!rule.validTo || isoDate <= rule.validTo);
}

function classifyRule(rule: ScoringRule): 'base' | 'bonus' {
  return rule.ruleKind === 'achievement' || rule.activityType === 'power_bonus' ? 'bonus' : 'base';
}

function evaluateThresholdValue(
  value: number | undefined,
  rule: ScoringRule,
): { passed: boolean; comparisonValue?: number; roundingPolicy?: string } {
  if (rule.thresholdOperator === 'exists') return { passed: value !== undefined, comparisonValue: value };
  if (value === undefined || rule.thresholdValue === undefined) return { passed: false };
  const roundsRunPace = rule.pointsMultiplier === 'rounded_5k_blocks' && rule.metric === 'pace_s_per_km';
  const comparisonValue = roundsRunPace ? roundToIncrement(value, RUN_BONUS_PACE_INCREMENT_S_PER_KM) : value;
  const roundingPolicy = roundsRunPace ? RUN_BONUS_ELIGIBILITY_ROUNDING : undefined;
  let passed: boolean;
  switch (rule.thresholdOperator) {
    case 'lt': passed = comparisonValue < rule.thresholdValue; break;
    case 'lte': passed = comparisonValue <= rule.thresholdValue; break;
    case 'gt': passed = comparisonValue > rule.thresholdValue; break;
    case 'gte': passed = comparisonValue >= rule.thresholdValue; break;
    case 'eq': passed = comparisonValue === rule.thresholdValue; break;
    default: passed = false;
  }
  return { passed, comparisonValue, roundingPolicy };
}

function roundToIncrement(value: number, increment: number): number {
  return Math.round((value + Number.EPSILON) / increment) * increment;
}

function achievementAuxiliaryConditions(
  activity: ActivityFact,
  rule: ScoringRule,
): Array<{ metric: string; operator: string; expected: number; actual: number; passed: boolean }> {
  if (rule.code === 'swim.1k.sub20.bonus') {
    const actual = activity.distanceM ?? 0;
    return [{ metric: 'distance_m', operator: 'gte', expected: 1000, actual, passed: actual >= 1000 }];
  }
  if (rule.code === 'run.5k.sub25.bonus') {
    const actual = activity.distanceM ?? 0;
    return [{ metric: 'distance_m', operator: 'within', expected: 5000, actual, passed: Math.abs(actual - 5000) <= 500 }];
  }
  if (rule.code === 'run.10k.completed.bonus') {
    const distanceM = activity.distanceM ?? 0;
    const durationS = activity.durationS;
    const actual = durationS !== undefined && distanceM > 0 ? durationS / (distanceM / 1000) : 0;
    return [{ metric: 'pace_s_per_km', operator: 'lte', expected: 300, actual, passed: durationS !== undefined && distanceM > 0 && actual <= 300 }];
  }
  if (rule.code === 'bike.10k.easy.bonus') {
    const actual = activity.distanceM ?? 0;
    return [{ metric: 'distance_m', operator: 'gte', expected: 10_000, actual, passed: actual >= 10_000 }];
  }
  return [];
}

function formatThreshold(
  value: number | undefined,
  rule: ScoringRule,
  evaluation: { comparisonValue?: number; roundingPolicy?: string },
): string {
  if (rule.thresholdOperator === 'exists') return `${rule.metric} exists`;
  if (evaluation.roundingPolicy) {
    return `${value ?? 'missing'} ${metricUnit(rule.metric)} rounded to ${evaluation.comparisonValue ?? 'missing'} ${metricUnit(rule.metric)} <= ${rule.thresholdValue ?? 'missing'} ${rule.thresholdUnit ?? metricUnit(rule.metric)}`;
  }
  return `${value ?? 'missing'} ${metricUnit(rule.metric)} ${rule.thresholdOperator ?? 'unknown'} ${rule.thresholdValue ?? 'missing'} ${rule.thresholdUnit ?? metricUnit(rule.metric)}`;
}

function metricUnit(metric: string): string {
  switch (metric) {
    case 'steps': return 'steps';
    case 'distance_m': return 'm';
    case 'distance_km': return 'km';
    case 'duration_s': return 's';
    case 'pace_s_per_km': return 's/km';
    case 'avg_speed_mps': return 'm/s';
    case 'avg_speed_kmh': return 'km/h';
    case 'effort_points': return 'points';
    default: return 'units';
  }
}

function splitDistanceActivities(
  facts: DailyMetricFacts,
  activityType: 'run' | 'bike',
  aggregateM: number,
  indoorM: number | undefined,
  outdoorM: number | undefined,
  unspecifiedM: number | undefined,
  splitBySubtype: boolean,
): ActivityFact[] {
  if (!splitBySubtype || (indoorM === undefined && outdoorM === undefined && unspecifiedM === undefined)) {
    return [{ activityDate: facts.metricDate, activityType, distanceM: aggregateM }];
  }
  const indoorSubtype = activityType === 'run' ? 'treadmill' : 'indoor';
  const classifiedM = (indoorM ?? 0) + (outdoorM ?? 0);
  const remainderM = unspecifiedM ?? Math.max(aggregateM - classifiedM, 0);
  const activities: ActivityFact[] = [
    { activityDate: facts.metricDate, activityType, subtype: indoorSubtype, distanceM: indoorM ?? 0 },
    { activityDate: facts.metricDate, activityType, subtype: 'outdoor', distanceM: outdoorM ?? 0 },
  ];
  if (remainderM > 0) activities.push({ activityDate: facts.metricDate, activityType, subtype: 'unknown', distanceM: remainderM });
  return activities;
}

function syntheticRuleApplies(
  rule: ScoringRule,
  activity: ActivityFact,
  facts: DailyMetricFacts,
  activeRules: ScoringRule[],
): boolean {
  if (rule.activitySubtype && rule.activitySubtype !== activity.subtype) return false;
  if (rule.code === 'run.km.default' && activity.subtype !== 'unknown' && hasSubtypeBreakdown(facts.runIndoorM, facts.runOutdoorM, facts.runUnspecifiedM)
    && hasSubtypeRules(activeRules, 'run')) return false;
  if (rule.code === 'bike.km.default' && activity.subtype !== 'unknown' && hasSubtypeBreakdown(facts.bikeIndoorM, facts.bikeOutdoorM, facts.bikeUnspecifiedM)
    && hasSubtypeRules(activeRules, 'bike')) return false;
  return true;
}

function hasSubtypeBreakdown(indoorM: number | undefined, outdoorM: number | undefined, unspecifiedM: number | undefined): boolean {
  return indoorM !== undefined || outdoorM !== undefined || unspecifiedM !== undefined;
}

function hasSubtypeRules(rules: ScoringRule[], activityType: 'run' | 'bike'): boolean {
  return rules.some((rule) => rule.activityType === activityType && rule.activitySubtype && rule.ruleKind !== 'achievement');
}

function activityDistancesMatchAggregate(
  activities: ActivityFact[],
  activityType: 'run' | 'bike',
  facts: DailyMetricFacts,
): boolean {
  const sourceDistanceM = activities
    .filter((activity) => activity.activityType === activityType)
    .reduce((sum, activity) => sum + (activity.distanceM ?? 0), 0);
  const aggregateM = activityType === 'run' ? facts.runM : facts.bikeM;
  return sourceDistanceM > 0 && Math.abs(sourceDistanceM - aggregateM) < 0.001;
}

function activityRuleApplies(rule: ScoringRule, activity: ActivityFact, activeRules: ScoringRule[]): boolean {
  if (rule.activitySubtype) return rule.activitySubtype === activity.subtype;
  if ((rule.code === 'run.km.default' || rule.code === 'bike.km.default')
    && activity.subtype !== undefined
    && activity.subtype !== 'unknown'
    && hasSubtypeRules(activeRules, activity.activityType as 'run' | 'bike')) return false;
  return true;
}

function scoreActivityWithConfirmedSubtypeCoefficient(
  activity: ActivityFact,
  rule: ScoringRule,
  metricDate: string,
): ScoreLedgerEntry | null {
  const coefficient = confirmedSubtypeCoefficient(rule, activity);
  if (coefficient === undefined) return scoreActivityWithRule(activity, rule, metricDate);
  const entry = scoreActivityWithRule(activity, { ...rule, coefficient }, metricDate);
  if (!entry) return null;
  entry.calculationJson = {
    ...entry.calculationJson,
    coefficientSource: 'confirmed_workbook_subtype_semantics',
    sourceFormula: confirmedSubtypeFormula(activity),
    configuredCoefficient: rule.coefficient ?? null,
    appliedCoefficient: coefficient,
  };
  return entry;
}

function confirmedSubtypeCoefficient(rule: ScoringRule, activity: ActivityFact): number | undefined {
  if (rule.code === 'run.km.default') {
    if (activity.subtype === 'treadmill') return 1850;
    if (activity.subtype === 'outdoor') return 1700;
  }
  if (rule.code === 'bike.km.default') {
    if (activity.subtype === 'indoor') return 700;
    if (activity.subtype === 'outdoor') return 600;
  }
  return undefined;
}

function confirmedSubtypeFormula(activity: ActivityFact): string {
  if (activity.activityType === 'run' && activity.subtype === 'treadmill') return 'Excel: treadmill run km × 1850';
  if (activity.activityType === 'run' && activity.subtype === 'outdoor') return 'Excel: outdoor run km × 1700';
  if (activity.activityType === 'bike' && activity.subtype === 'indoor') return 'Excel: indoor bike km × 700';
  if (activity.activityType === 'bike' && activity.subtype === 'outdoor') return 'Excel: outdoor bike km × 600';
  return 'Excel activity coefficient';
}

function getMetricValue(activity: ActivityFact, metric: string): number | undefined {
  switch (metric) {
    case 'steps': return activity.steps;
    case 'distance_m': return activity.distanceM;
    case 'distance_km': return activity.distanceM === undefined ? undefined : metersToKm(activity.distanceM);
    case 'duration_s': return activity.durationS;
    case 'pace_s_per_km': {
      if (activity.durationS === undefined || activity.distanceM === undefined || activity.distanceM <= 0) return undefined;
      return activity.durationS / (activity.distanceM / 1000);
    }
    case 'avg_speed_mps': return activity.avgSpeedMps;
    case 'avg_speed_kmh': return activity.avgSpeedMps === undefined ? undefined : mpsToKmh(activity.avgSpeedMps);
    case 'effort_points': return activity.effortPoints;
    default: return undefined;
  }
}
