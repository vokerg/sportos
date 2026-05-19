import type { ActivityFact, DailyMetricFacts, DailyScoreResult, ScoringRule, ScoreLedgerEntry } from './types.js';
import { metersToKm, mpsToKmh } from './units.js';

export function scoreDay(facts: DailyMetricFacts, activities: ActivityFact[], rules: ScoringRule[]): DailyScoreResult {
  const activeRules = rules
    .filter((rule) => rule.enabled && isRuleActiveForDate(rule, facts.metricDate))
    .sort((a, b) => a.priority - b.priority);

  const ledger: ScoreLedgerEntry[] = [];

  const syntheticDailyActivities: ActivityFact[] = [
    { activityDate: facts.metricDate, activityType: 'steps', steps: facts.steps },
    { activityDate: facts.metricDate, activityType: 'run', distanceM: facts.runM },
    { activityDate: facts.metricDate, activityType: 'bike', distanceM: facts.bikeM },
    { activityDate: facts.metricDate, activityType: 'swim', distanceM: facts.swimM },
    { activityDate: facts.metricDate, activityType: 'workout', effortPoints: facts.workoutPoints },
    { activityDate: facts.metricDate, activityType: 'power_bonus', effortPoints: facts.powerPoints },
  ];

  for (const activity of syntheticDailyActivities) {
    for (const rule of activeRules.filter((r) => r.activityType === activity.activityType)) {
      const entry = scoreActivityWithRule(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
  }

  // Achievement rules should also evaluate activity-level data, e.g. a 5k under 25 minutes.
  for (const activity of activities.filter((a) => a.activityDate === facts.metricDate)) {
    for (const rule of activeRules.filter((r) => r.activityType === activity.activityType && r.ruleKind === 'achievement')) {
      const entry = scoreActivityWithRule(activity, rule, facts.metricDate);
      if (entry) ledger.push(entry);
    }
  }

  const basePoints = ledger
    .filter((e) => !String(e.ruleCode ?? '').includes('.bonus'))
    .reduce((sum, e) => sum + e.points, 0);
  const bonusPoints = ledger.reduce((sum, e) => sum + e.points, 0) - basePoints;

  return {
    metricDate: facts.metricDate,
    basePoints,
    bonusPoints,
    totalPoints: basePoints + bonusPoints,
    ledger,
  };
}

export function scoreActivityWithRule(activity: ActivityFact, rule: ScoringRule, metricDate: string): ScoreLedgerEntry | null {
  if (!rule.enabled) return null;

  if (rule.ruleKind === 'coefficient') {
    const metricValue = getMetricValue(activity, rule.metric);
    if (metricValue === undefined || rule.coefficient === undefined) return null;
    const points = Math.round(metricValue * rule.coefficient);
    if (points === 0) return null;
    return {
      metricDate,
      activityId: activity.id,
      ruleId: rule.id,
      ruleCode: rule.code,
      points,
      reason: `${rule.name}: ${metricValue} × ${rule.coefficient}`,
      calculationJson: { metric: rule.metric, metricValue, coefficient: rule.coefficient },
    };
  }

  if (rule.ruleKind === 'manual_points') {
    const metricValue = getMetricValue(activity, rule.metric) ?? 0;
    const multiplier = rule.coefficient ?? 1;
    const points = Math.round(metricValue * multiplier);
    if (points === 0) return null;
    return {
      metricDate,
      activityId: activity.id,
      ruleId: rule.id,
      ruleCode: rule.code,
      points,
      reason: `${rule.name}: ${points} manual points`,
      calculationJson: { metric: rule.metric, metricValue, multiplier },
    };
  }

  if (rule.ruleKind === 'achievement') {
    if (!passesThreshold(activity, rule)) return null;
    if (rule.code === 'swim.1k.sub20.bonus' && (activity.distanceM ?? 0) < 1000) return null;
    if (rule.code === 'run.5k.sub25.bonus' && Math.abs((activity.distanceM ?? 0) - 5000) > 500) return null;
    const points = rule.points ?? 0;
    if (points === 0) return null;
    return {
      metricDate,
      activityId: activity.id,
      ruleId: rule.id,
      ruleCode: rule.code,
      points,
      reason: `${rule.name}: +${points}`,
      calculationJson: { metric: rule.metric, thresholdOperator: rule.thresholdOperator, thresholdValue: rule.thresholdValue },
    };
  }

  return null;
}

export function isRuleActiveForDate(rule: ScoringRule, isoDate: string): boolean {
  return rule.validFrom <= isoDate && (!rule.validTo || isoDate <= rule.validTo);
}

function passesThreshold(activity: ActivityFact, rule: ScoringRule): boolean {
  const value = getMetricValue(activity, rule.metric);
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
