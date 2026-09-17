import { HttpErrorResponse } from '@angular/common/http';
import type {
  ActivityType,
  RuleChange,
  RuleKind,
  RuleProposal,
  RuleVersion,
} from './api.service';

export const RULE_ACTIVITY_TYPES: readonly ActivityType[] = [
  'steps',
  'run',
  'bike',
  'swim',
  'workout',
  'rowing',
  'sup',
  'hiit',
  'bonus',
];

export const RULE_KINDS: readonly RuleKind[] = ['coefficient', 'achievement', 'manual_points'];

export function newRuleProposal(validFrom = todayIso()): RuleProposal {
  return {
    code: 'run.distance.custom',
    name: 'Custom run distance',
    activityType: 'run',
    ruleKind: 'coefficient',
    metric: 'distance_km',
    coefficient: 1000,
    validFrom,
    priority: 100,
  };
}

export function proposalFromRule(rule: RuleVersion, validFrom = todayIso()): RuleProposal {
  return {
    replaceRuleId: rule.id,
    code: rule.code,
    name: rule.name,
    activityType: rule.activityType,
    activitySubtype: rule.activitySubtype,
    ruleKind: rule.ruleKind,
    metric: rule.metric,
    coefficient: rule.coefficient,
    thresholdOperator: rule.thresholdOperator,
    thresholdValue: rule.thresholdValue,
    thresholdUnit: rule.thresholdUnit,
    points: rule.points,
    achievementGroup: rule.achievementGroup,
    pointsMultiplier: rule.pointsMultiplier,
    validFrom,
    validTo: undefined,
    priority: rule.priority,
    description: rule.description,
  };
}

export function metricOptionsFor(activityType: ActivityType): string[] {
  if (activityType === 'steps') return ['steps'];
  if (['workout', 'hiit', 'bonus'].includes(activityType)) return ['effort_points'];
  const distanceMetrics = ['distance_m', 'distance_km', 'duration_s', 'avg_speed_mps', 'avg_speed_kmh'];
  return activityType === 'run'
    ? [...distanceMetrics.slice(0, 3), 'pace_s_per_km', ...distanceMetrics.slice(3)]
    : distanceMetrics;
}

export function updateProposalActivity(proposal: RuleProposal, activityType: ActivityType): RuleProposal {
  const metrics = metricOptionsFor(activityType);
  const metric = metrics.includes(proposal.metric) ? proposal.metric : (metrics[0] ?? '');
  return {
    ...proposal,
    activityType,
    metric,
    thresholdUnit: metricUnit(metric),
  };
}

export function updateProposalRuleKind(proposal: RuleProposal, ruleKind: RuleKind): RuleProposal {
  if (ruleKind === 'achievement') {
    return {
      ...proposal,
      ruleKind,
      coefficient: undefined,
      thresholdOperator: proposal.thresholdOperator ?? 'gte',
      thresholdValue: proposal.thresholdValue ?? 0,
      thresholdUnit: metricUnit(proposal.metric),
      points: proposal.points ?? 1,
    };
  }

  return {
    ...proposal,
    ruleKind,
    coefficient: proposal.coefficient ?? 1,
    thresholdOperator: undefined,
    thresholdValue: undefined,
    thresholdUnit: undefined,
    points: undefined,
  };
}

export function cleanRuleProposal(proposal: RuleProposal): RuleProposal {
  return {
    ...proposal,
    validTo: proposal.validTo || undefined,
    description: proposal.description?.trim() || undefined,
  };
}

export function metricUnit(metric: string): string {
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

export function ruleFormula(
  rule: Pick<RuleVersion, 'ruleKind' | 'coefficient' | 'thresholdOperator' | 'thresholdValue' | 'thresholdUnit' | 'points' | 'pointsMultiplier'>,
): string {
  if (rule.ruleKind === 'achievement') {
    const multiplier = rule.pointsMultiplier === 'rounded_5k_blocks'
      ? ' per rounded 5 km (pace rounded favourably)'
      : rule.pointsMultiplier === 'completed_5k_blocks' ? ' per completed 5 km' : '';
    return `${rule.thresholdOperator} ${rule.thresholdValue ?? ''} ${rule.thresholdUnit ?? ''} → +${rule.points ?? 0}${multiplier}`;
  }
  return `× ${rule.coefficient ?? 0}`;
}

export function signedRuleDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function ruleChangeResultSummary(change: RuleChange): string {
  const result = change.result as { datesRecomputed?: number } | null;
  return result?.datesRecomputed === undefined ? '' : `${result.datesRecomputed} dates recomputed`;
}

export function isTerminalRuleChange(change: RuleChange): boolean {
  return change.status === 'succeeded' || change.status === 'failed' || change.status === 'cancelled';
}

export function describeRuleRequestError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: string; issues?: Array<{ message?: string }> } | null;
    if (body?.issues?.length) return body.issues.map((issue) => issue.message).filter(Boolean).join(' ');
    if (body?.message) return body.message;
  }
  return error instanceof Error ? error.message : 'Rules Studio request failed.';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
