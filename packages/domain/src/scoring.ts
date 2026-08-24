import type { ActivityFact, DailyMetricFacts, DailyScoreResult, ScoringRule, ScoreLedgerEntry } from './types.js';
import { metersToKm, mpsToKmh } from './units.js';

const ROUNDING_POLICY = 'nearest_integer_per_rule';

export function scoreDay(facts: DailyMetricFacts, activities: ActivityFact[], rules: ScoringRule[]): DailyScoreResult {
  const activeRules = rules
    .filter((rule) => rule.enabled && isRuleActiveForDate(rule, facts.metricDate))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));

  const ledger: ScoreLedgerEntry[] = [];
  const datedActivities = activities.filter((candidate) => candidate.activityDate === facts.metricDate);
  const workbookActivities = datedActivities.filter(
    (candidate) => candidate.source === 'my_sport_xlsx' && (candidate.activityType === 'run' || candidate.activityType === 'bike'),
  );
  const workbookBackedTypes = new Set(
    (['run', 'bike'] as const).filter((activityType) => workbookActivityMatchesAggregate(workbookActivities, activityType, facts)),
  );

  const syntheticDailyActivities = ([
    { activityDate: facts.metricDate, activityType: 'steps', steps: facts.steps },
    ...splitDistanceActivities(facts, 'run', facts.runM, facts.runIndoorM, facts.runOutdoorM, activeRules),
    ...splitDistanceActivities(facts, 'bike', facts.bikeM, facts.bikeIndoorM, facts.bikeOutdoorM, activeRules),
    { activityDate: facts.metricDate, activityType: 'swim', distanceM: facts.swimM },
    { activityDate: facts.metricDate, activityType: 'workout', effortPoints: facts.workoutPoints },
    { activityDate: facts.metricDate, activityType: 'power_bonus', effortPoints: facts.powerPoints },
  ] as ActivityFact[]).filter((activity) => !workbookBackedTypes.has(activity.activityType as 'run' | 'bike'));

  // Daily aggregates drive coefficient/manual rules only. Achievement rules must
  // evaluate one canonical activity so separate sessions are never combined into
  // a synthetic threshold achievement.
  for (const activity of syntheticDailyActivities) {
    for (const rule of activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType
        && candidate.ruleKind !== 'achievement'
        && syntheticRuleApplies(candidate, activity, facts, activeRules),
    )) {
      const entry = scoreActivityWithRule(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
  }

  for (const activity of workbookActivities) {
    if (!workbookBackedTypes.has(activity.activityType as 'run' | 'bike')) continue;
    for (const rule of activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType
        && candidate.ruleKind !== 'achievement'
        && (!candidate.activitySubtype || candidate.activitySubtype === activity.subtype),
    )) {
      const entry = scoreWorkbookActivity(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
  }

  for (const activity of datedActivities) {
    for (const rule of activeRules.filter(
      (candidate) => candidate.activityType === activity.activityType
        && candidate.ruleKind === 'achievement'
        && (!candidate.activitySubtype || candidate.activitySubtype === activity.subtype),
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

function splitDistanceActivities(
  facts: DailyMetricFacts,
  activityType: 'run' | 'bike',
  aggregateM: number,
  indoorM: number | undefined,
  outdoorM: number | undefined,
  activeRules: ScoringRule[],
): ActivityFact[] {
  if ((indoorM === undefined && outdoorM === undefined) || !hasSubtypeRules(activeRules, activityType)) {
    return [{ activityDate: facts.metricDate, activityType, distanceM: aggregateM }];
  }
  const indoorSubtype = activityType === 'run' ? 'treadmill' : 'indoor';
  return [
    { activityDate: facts.metricDate, activityType, subtype: indoorSubtype, distanceM: indoorM ?? 0 },
    { activityDate: facts.metricDate, activityType, subtype: 'outdoor', distanceM: outdoorM ?? 0 },
  ];
}

function syntheticRuleApplies(
  rule: ScoringRule,
  activity: ActivityFact,
  facts: DailyMetricFacts,
  activeRules: ScoringRule[],
): boolean {
  if (rule.activitySubtype && rule.activitySubtype !== activity.subtype) return false;
  if (rule.code === 'run.km.default' && hasSubtypeBreakdown(facts.runIndoorM, facts.runOutdoorM)
    && hasSubtypeRules(activeRules, 'run')) return false;
  if (rule.code === 'bike.km.default' && hasSubtypeBreakdown(facts.bikeIndoorM, facts.bikeOutdoorM)
    && hasSubtypeRules(activeRules, 'bike')) return false;
  return true;
}

function hasSubtypeBreakdown(indoorM: number | undefined, outdoorM: number | undefined): boolean {
  return indoorM !== undefined || outdoorM !== undefined;
}

function hasSubtypeRules(rules: ScoringRule[], activityType: 'run' | 'bike'): boolean {
  return rules.some((rule) => rule.activityType === activityType && rule.activitySubtype && rule.ruleKind !== 'achievement');
}

function workbookActivityMatchesAggregate(
  activities: ActivityFact[],
  activityType: 'run' | 'bike',
  facts: DailyMetricFacts,
): boolean {
  // Only override the configured SportOS coefficient when the workbook also
  // supplied its row total. A partial row without an Excel total is not enough
  // evidence to replace the active SportOS rule.
  if (facts.excelAllPoints === undefined) return false;
  const sourceDistanceM = activities
    .filter((activity) => activity.activityType === activityType)
    .reduce((sum, activity) => sum + (activity.distanceM ?? 0), 0);
  const aggregateM = activityType === 'run' ? facts.runM : facts.bikeM;
  return sourceDistanceM > 0 && Math.abs(sourceDistanceM - aggregateM) < 0.001;
}

function scoreWorkbookActivity(activity: ActivityFact, rule: ScoringRule, metricDate: string): ScoreLedgerEntry | null {
  const coefficient = workbookCoefficient(rule, activity);
  if (coefficient === undefined) return scoreActivityWithRule(activity, rule, metricDate);
  const entry = scoreActivityWithRule(activity, { ...rule, coefficient }, metricDate);
  if (!entry) return null;
  entry.calculationJson = {
    ...entry.calculationJson,
    workbookFormula: workbookFormula(activity),
    configuredCoefficient: rule.coefficient ?? null,
    workbookCoefficient: coefficient,
  };
  return entry;
}

function workbookCoefficient(rule: ScoringRule, activity: ActivityFact): number | undefined {
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

function workbookFormula(activity: ActivityFact): string {
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
    case 'avg_speed_mps': return activity.avgSpeedMps;
    case 'avg_speed_kmh': return activity.avgSpeedMps === undefined ? undefined : mpsToKmh(activity.avgSpeedMps);
    case 'effort_points': return activity.effortPoints;
    default: return undefined;
  }
}
