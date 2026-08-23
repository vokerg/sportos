import type { ActivityFact, DailyMetricFacts, DailyScoreResult, ScoringRule, ScoreLedgerEntry } from './types.js';
import { metersToKm, mpsToKmh } from './units.js';

const ROUNDING_POLICY = 'nearest_integer_per_rule';

export function scoreDay(facts: DailyMetricFacts, activities: ActivityFact[], rules: ScoringRule[]): DailyScoreResult {
  const activeRules = rules
    .filter((rule) => rule.enabled && isRuleActiveForDate(rule, facts.metricDate))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));

  const ledger: ScoreLedgerEntry[] = [];

  const syntheticDailyActivities: ActivityFact[] = [
    { activityDate: facts.metricDate, activityType: 'steps', steps: facts.steps },
    { activityDate: facts.metricDate, activityType: 'run', distanceM: facts.runM },
    { activityDate: facts.metricDate, activityType: 'bike', distanceM: facts.bikeM },
    { activityDate: facts.metricDate, activityType: 'swim', distanceM: facts.swimM },
    { activityDate: facts.metricDate, activityType: 'workout', effortPoints: facts.workoutPoints },
    { activityDate: facts.metricDate, activityType: 'power_bonus', effortPoints: facts.powerPoints },
  ];

  // Daily aggregates drive coefficient/manual rules only. Achievement rules must
  // evaluate one canonical activity so separate sessions are never combined into
  // a synthetic threshold achievement.
  for (const activity of syntheticDailyActivities) {
    for (const rule of activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType && candidate.ruleKind !== 'achievement',
    )) {
      const entry = scoreActivityWithRule(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
  }

  for (const activity of activities.filter((candidate) => candidate.activityDate === facts.metricDate)) {
    for (const rule of activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType && candidate.ruleKind === 'achievement',
    )) {
      const entry = scoreActivityWithRule(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
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
    if (!passesThresholdValue(metricValue, rule)) return null;
    const auxiliaryConditions = achievementAuxiliaryConditions(activity, rule);
    if (auxiliaryConditions.some((condition) => !condition.passed)) return null;
    const points = rule.points ?? 0;
    if (points === 0) return null;
    return {
      metricDate,
      activityId: activity.id,
      ruleId: rule.id,
      ruleCode: rule.code,
      points,
      reason: `${rule.name}: ${formatThreshold(metricValue, rule)}; +${points}`,
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
        configuredPoints: points,
        auxiliaryConditions,
        validFrom: rule.validFrom,
        validTo: rule.validTo ?? null,
        priority: rule.priority,
      },
    };
  }

  return null;
}

export function isRuleActiveForDate(rule: ScoringRule, isoDate: string): boolean {
  return rule.validFrom <= isoDate && (!rule.validTo || isoDate <= rule.validTo);
}

function classifyRule(rule: ScoringRule): 'base' | 'bonus' {
  return rule.ruleKind === 'achievement' || rule.activityType === 'power_bonus' ? 'bonus' : 'base';
}

function passesThresholdValue(value: number | undefined, rule: ScoringRule): boolean {
  if (rule.thresholdOperator === 'exists') return value !== undefined;
  if (value === undefined || rule.thresholdValue === undefined) return false;
  switch (rule.thresholdOperator) {
    case 'lt': return value < rule.thresholdValue;
    case 'lte': return value <= rule.thresholdValue;
    case 'gt': return value > rule.thresholdValue;
    case 'gte': return value >= rule.thresholdValue;
    case 'eq': return value === rule.thresholdValue;
    default: return false;
  }
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
  return [];
}

function formatThreshold(value: number | undefined, rule: ScoringRule): string {
  if (rule.thresholdOperator === 'exists') return `${rule.metric} exists`;
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

function getMetricValue(activity: ActivityFact, metric: string): number | undefined {
  switch (metric) {
    case 'steps': return activity.steps;
    case 'distance_m': return activity.distanceM;
    case 'distance_km': return activity.distanceM === undefined ? undefined : metersToKm(activity.distanceM);
    case 'duration_s': return activity.durationS;
    case 'avg_speed_mps': return activity.avgSpeedMps;
    case 'avg_speed_kmh': return activity.avgSpeedMps === undefined ? undefined : mpsToKmh(activity.avgSpeedMps);
    case 'effort_points': return activity.effortPoints;
    default: return undefined;
  }
}
