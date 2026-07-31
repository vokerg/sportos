import { scoreDay } from './scoring.js';
import type {
  ActivityFact,
  ActivityType,
  DailyMetricFacts,
  RuleKind,
  ScoringRule,
  ThresholdOperator,
} from './types.js';

export interface RuleProposal {
  replaceRuleId?: string;
  code: string;
  name: string;
  activityType: ActivityType;
  ruleKind: RuleKind;
  metric: string;
  coefficient?: number;
  thresholdOperator?: ThresholdOperator;
  thresholdValue?: number;
  thresholdUnit?: string;
  points?: number;
  validFrom: string;
  validTo?: string;
  priority: number;
  description?: string;
}

export interface RuleProposalIssue {
  field: keyof RuleProposal | 'proposal';
  code: string;
  message: string;
}

export class RuleProposalValidationError extends Error {
  constructor(readonly issues: RuleProposalIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'RuleProposalValidationError';
  }
}

export interface RulePreviewDay {
  facts: DailyMetricFacts;
  activities: ActivityFact[];
  currentBasePoints: number;
  currentBonusPoints: number;
  currentTotalPoints: number;
  recomputedAt: string;
}

export interface RulePreviewRow {
  metricDate: string;
  currentBasePoints: number;
  proposedBasePoints: number;
  currentBonusPoints: number;
  proposedBonusPoints: number;
  currentTotalPoints: number;
  proposedTotalPoints: number;
  delta: number;
}

export interface RuleChangePreview {
  affectedFrom: string;
  affectedTo: string;
  totalDates: number;
  changedDates: number;
  aggregateDelta: number;
  minimumDelta: number;
  maximumDelta: number;
  rows: RulePreviewRow[];
}

const ACTIVITY_TYPES: ActivityType[] = [
  'steps',
  'run',
  'bike',
  'swim',
  'workout',
  'rowing',
  'sup',
  'hiit',
  'power_bonus',
];
const RULE_KINDS: RuleKind[] = ['coefficient', 'achievement', 'manual_points'];
const THRESHOLD_OPERATORS: ThresholdOperator[] = ['lt', 'lte', 'gt', 'gte', 'eq', 'exists'];
const METRICS_BY_ACTIVITY: Record<ActivityType, string[]> = {
  steps: ['steps'],
  run: ['distance_m', 'distance_km', 'duration_s', 'avg_speed_mps', 'avg_speed_kmh'],
  bike: ['distance_m', 'distance_km', 'duration_s', 'avg_speed_mps', 'avg_speed_kmh'],
  swim: ['distance_m', 'distance_km', 'duration_s', 'avg_speed_mps', 'avg_speed_kmh'],
  workout: ['effort_points'],
  rowing: ['distance_m', 'distance_km', 'duration_s', 'avg_speed_mps', 'avg_speed_kmh'],
  sup: ['distance_m', 'distance_km', 'duration_s', 'avg_speed_mps', 'avg_speed_kmh'],
  hiit: ['effort_points'],
  power_bonus: ['effort_points'],
};

export function normalizeRuleProposal(input: RuleProposal): RuleProposal {
  const proposal: RuleProposal = {
    replaceRuleId: optionalTrimmed(input.replaceRuleId),
    code: String(input.code ?? '').trim(),
    name: String(input.name ?? '').trim(),
    activityType: input.activityType,
    ruleKind: input.ruleKind,
    metric: String(input.metric ?? '').trim(),
    validFrom: String(input.validFrom ?? '').trim(),
    validTo: optionalTrimmed(input.validTo),
    priority: Number(input.priority),
    description: optionalTrimmed(input.description),
  };

  if (input.ruleKind === 'coefficient' || input.ruleKind === 'manual_points') {
    proposal.coefficient = optionalNumber(input.coefficient);
  }
  if (input.ruleKind === 'achievement') {
    proposal.thresholdOperator = input.thresholdOperator;
    proposal.thresholdValue = optionalNumber(input.thresholdValue);
    proposal.thresholdUnit = optionalTrimmed(input.thresholdUnit);
    proposal.points = optionalNumber(input.points);
  }
  return proposal;
}

export function validateRuleProposal(input: RuleProposal): RuleProposal {
  const proposal = normalizeRuleProposal(input);
  const issues: RuleProposalIssue[] = [];

  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(proposal.code) || proposal.code.length > 120) {
    issues.push({ field: 'code', code: 'INVALID_RULE_CODE', message: 'Rule code must be a lowercase stable identifier up to 120 characters.' });
  }
  if (!proposal.name || proposal.name.length > 160) {
    issues.push({ field: 'name', code: 'INVALID_RULE_NAME', message: 'Rule name is required and must be at most 160 characters.' });
  }
  if (!ACTIVITY_TYPES.includes(proposal.activityType)) {
    issues.push({ field: 'activityType', code: 'INVALID_ACTIVITY_TYPE', message: 'Activity type is not supported.' });
  }
  if (!RULE_KINDS.includes(proposal.ruleKind)) {
    issues.push({ field: 'ruleKind', code: 'INVALID_RULE_KIND', message: 'Rule kind is not supported.' });
  }
  if (!METRICS_BY_ACTIVITY[proposal.activityType]?.includes(proposal.metric)) {
    issues.push({ field: 'metric', code: 'INVALID_RULE_METRIC', message: `Metric ${proposal.metric || '(missing)'} is not valid for ${proposal.activityType}.` });
  }
  if (!isIsoDate(proposal.validFrom)) {
    issues.push({ field: 'validFrom', code: 'INVALID_VALID_FROM', message: 'Valid from must be a real YYYY-MM-DD calendar date.' });
  }
  if (proposal.validTo !== undefined && !isIsoDate(proposal.validTo)) {
    issues.push({ field: 'validTo', code: 'INVALID_VALID_TO', message: 'Valid to must be a real YYYY-MM-DD calendar date.' });
  }
  if (proposal.validTo && isIsoDate(proposal.validFrom) && proposal.validTo < proposal.validFrom) {
    issues.push({ field: 'validTo', code: 'INVALID_EFFECTIVE_RANGE', message: 'Valid to cannot be earlier than valid from.' });
  }
  if (!Number.isInteger(proposal.priority) || proposal.priority < 0 || proposal.priority > 10_000) {
    issues.push({ field: 'priority', code: 'INVALID_PRIORITY', message: 'Priority must be an integer from 0 through 10000.' });
  }
  if (proposal.description && proposal.description.length > 1000) {
    issues.push({ field: 'description', code: 'DESCRIPTION_TOO_LONG', message: 'Description must be at most 1000 characters.' });
  }
  if (proposal.replaceRuleId && !isUuid(proposal.replaceRuleId)) {
    issues.push({ field: 'replaceRuleId', code: 'INVALID_REPLACEMENT_RULE', message: 'Replacement rule id must be a UUID.' });
  }

  if (proposal.ruleKind === 'coefficient' || proposal.ruleKind === 'manual_points') {
    if (!isFinitePositive(proposal.coefficient)) {
      issues.push({ field: 'coefficient', code: 'INVALID_COEFFICIENT', message: 'Coefficient must be a finite number greater than zero.' });
    }
  }

  if (proposal.ruleKind === 'achievement') {
    if (!proposal.thresholdOperator || !THRESHOLD_OPERATORS.includes(proposal.thresholdOperator)) {
      issues.push({ field: 'thresholdOperator', code: 'INVALID_THRESHOLD_OPERATOR', message: 'Achievement threshold operator is required.' });
    }
    if (proposal.thresholdOperator !== 'exists' && !isFiniteNonNegative(proposal.thresholdValue)) {
      issues.push({ field: 'thresholdValue', code: 'INVALID_THRESHOLD_VALUE', message: 'Achievement threshold value must be a finite non-negative number.' });
    }
    const expectedUnit = metricUnit(proposal.metric);
    if (!proposal.thresholdUnit || proposal.thresholdUnit !== expectedUnit) {
      issues.push({ field: 'thresholdUnit', code: 'INVALID_THRESHOLD_UNIT', message: `Threshold unit must be ${expectedUnit} for ${proposal.metric}.` });
    }
    if (!Number.isInteger(proposal.points) || (proposal.points ?? 0) <= 0 || (proposal.points ?? 0) > 1_000_000) {
      issues.push({ field: 'points', code: 'INVALID_POINTS', message: 'Achievement points must be a positive integer no greater than 1000000.' });
    }
  }

  if (issues.length > 0) throw new RuleProposalValidationError(issues);
  return proposal;
}

export function proposalAsRule(proposal: RuleProposal, id?: string): ScoringRule {
  const normalized = validateRuleProposal(proposal);
  return {
    id,
    code: normalized.code,
    name: normalized.name,
    activityType: normalized.activityType,
    ruleKind: normalized.ruleKind,
    metric: normalized.metric,
    coefficient: normalized.coefficient,
    thresholdOperator: normalized.thresholdOperator,
    thresholdValue: normalized.thresholdValue,
    thresholdUnit: normalized.thresholdUnit,
    points: normalized.points,
    validFrom: normalized.validFrom,
    validTo: normalized.validTo,
    priority: normalized.priority,
    enabled: true,
    description: normalized.description,
  };
}

export function previewRuleChange(
  days: RulePreviewDay[],
  currentRules: ScoringRule[],
  input: RuleProposal,
): RuleChangePreview {
  const proposal = validateRuleProposal(input);
  const proposedRule = proposalAsRule(proposal, `preview:${proposal.code}`);
  const proposedRules = currentRules
    .filter((rule) => !proposal.replaceRuleId || rule.id !== proposal.replaceRuleId)
    .concat(proposedRule);

  const rows = days
    .filter((day) => day.facts.metricDate >= proposal.validFrom && (!proposal.validTo || day.facts.metricDate <= proposal.validTo))
    .sort((a, b) => a.facts.metricDate.localeCompare(b.facts.metricDate))
    .map((day): RulePreviewRow => {
      const proposed = scoreDay(day.facts, day.activities, proposedRules);
      return {
        metricDate: day.facts.metricDate,
        currentBasePoints: day.currentBasePoints,
        proposedBasePoints: proposed.basePoints,
        currentBonusPoints: day.currentBonusPoints,
        proposedBonusPoints: proposed.bonusPoints,
        currentTotalPoints: day.currentTotalPoints,
        proposedTotalPoints: proposed.totalPoints,
        delta: proposed.totalPoints - day.currentTotalPoints,
      };
    });

  const deltas = rows.map((row) => row.delta);
  return {
    affectedFrom: proposal.validFrom,
    affectedTo: proposal.validTo ?? rows.at(-1)?.metricDate ?? proposal.validFrom,
    totalDates: rows.length,
    changedDates: rows.filter((row) => row.delta !== 0).length,
    aggregateDelta: deltas.reduce((sum, delta) => sum + delta, 0),
    minimumDelta: deltas.length ? Math.min(...deltas) : 0,
    maximumDelta: deltas.length ? Math.max(...deltas) : 0,
    rows,
  };
}

export function metricUnit(metric: string): string {
  switch (metric) {
    case 'steps': return 'steps';
    case 'distance_m': return 'm';
    case 'distance_km': return 'km';
    case 'duration_s': return 's';
    case 'avg_speed_mps': return 'm/s';
    case 'avg_speed_kmh': return 'km/h';
    case 'effort_points': return 'points';
    default: return 'units';
  }
}

function optionalTrimmed(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return Number(value);
}

function isFinitePositive(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
