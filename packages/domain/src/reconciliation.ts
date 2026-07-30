import { scoreDay } from './scoring.js';
import type { ActivityFact, ActivityType, DailyMetricFacts, DailyScoreResult, ScoringRule } from './types.js';

export type ReconciliationStatus = 'exact' | 'explained' | 'unresolved' | 'not_comparable';
export type ComponentReconciliationStatus = 'exact' | 'within_tolerance' | 'mismatch' | 'unmapped';

export interface SpreadsheetScoreComponentEvidence {
  activityType: ActivityType;
  sourceColumn: string;
  importedPoints: number;
  roundingUnit?: number;
}

export interface ScoreReconciliationInput {
  facts: DailyMetricFacts;
  activities: ActivityFact[];
  rules: ScoringRule[];
  excelTotal?: number;
  sourceRoundingUnit?: number;
  sourceComponents?: SpreadsheetScoreComponentEvidence[];
}

export interface ComponentReconciliationResult {
  activityType: ActivityType;
  sourceColumn: string;
  importedPoints: number;
  appBasePoints: number;
  delta: number;
  tolerance: number;
  status: ComponentReconciliationStatus;
  ruleCodes: string[];
}

export interface ScoreReconciliationRow {
  date: string;
  appTotal: number;
  excelTotal: number | null;
  delta: number | null;
  absoluteDelta: number | null;
  tolerance: number;
  status: ReconciliationStatus;
  explanationCode:
    | 'exact_total'
    | 'sportos_bonus_excluded_from_excel'
    | 'source_rounding_tolerance'
    | 'unresolved_delta'
    | 'missing_excel_total';
  likelyRuleCodes: string[];
  activityTypes: ActivityType[];
  componentResults: ComponentReconciliationResult[];
  score: DailyScoreResult;
}

export interface ReconciliationGroup {
  key: string;
  count: number;
  dates: string[];
}

export interface ScoreReconciliationSummary {
  policy: {
    defaultTolerance: 0;
    roundingToleranceRequiresExplicitSourceUnit: true;
    bonusClassification: 'achievement_or_power_bonus';
    coefficientRounding: 'nearest_integer_per_rule';
  };
  counts: Record<ReconciliationStatus, number>;
  rows: ScoreReconciliationRow[];
  groups: {
    byStatus: ReconciliationGroup[];
    byMagnitude: ReconciliationGroup[];
    byActivityType: ReconciliationGroup[];
    byLikelyRule: ReconciliationGroup[];
  };
}

export function reconcileScores(inputs: ScoreReconciliationInput[]): ScoreReconciliationSummary {
  const rows = inputs
    .map(reconcileScore)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    policy: {
      defaultTolerance: 0,
      roundingToleranceRequiresExplicitSourceUnit: true,
      bonusClassification: 'achievement_or_power_bonus',
      coefficientRounding: 'nearest_integer_per_rule',
    },
    counts: {
      exact: rows.filter((row) => row.status === 'exact').length,
      explained: rows.filter((row) => row.status === 'explained').length,
      unresolved: rows.filter((row) => row.status === 'unresolved').length,
      not_comparable: rows.filter((row) => row.status === 'not_comparable').length,
    },
    rows,
    groups: {
      byStatus: groupRows(rows, (row) => [row.status]),
      byMagnitude: groupRows(rows, (row) => [magnitudeBucket(row.absoluteDelta)]),
      byActivityType: groupRows(rows, (row) => row.activityTypes),
      byLikelyRule: groupRows(rows, (row) => row.likelyRuleCodes.length > 0 ? row.likelyRuleCodes : ['none']),
    },
  };
}

export function reconcileScore(input: ScoreReconciliationInput): ScoreReconciliationRow {
  const score = scoreDay(input.facts, input.activities, input.rules);
  const excelTotal = input.excelTotal ?? input.facts.excelAllPoints;
  const tolerance = explicitTolerance(input.sourceRoundingUnit);
  const componentResults = reconcileComponents(score, input.rules, input.sourceComponents ?? []);
  const activityTypes = collectActivityTypes(score, input.rules, input.sourceComponents ?? []);

  if (excelTotal === undefined) {
    return {
      date: input.facts.metricDate,
      appTotal: score.totalPoints,
      excelTotal: null,
      delta: null,
      absoluteDelta: null,
      tolerance,
      status: 'not_comparable',
      explanationCode: 'missing_excel_total',
      likelyRuleCodes: [],
      activityTypes,
      componentResults,
      score,
    };
  }

  const delta = score.totalPoints - excelTotal;
  const absoluteDelta = Math.abs(delta);
  if (delta === 0) {
    return {
      date: input.facts.metricDate,
      appTotal: score.totalPoints,
      excelTotal,
      delta,
      absoluteDelta,
      tolerance,
      status: 'exact',
      explanationCode: 'exact_total',
      likelyRuleCodes: [],
      activityTypes,
      componentResults,
      score,
    };
  }

  if (score.bonusPoints !== 0 && excelTotal === score.basePoints && delta === score.bonusPoints) {
    return {
      date: input.facts.metricDate,
      appTotal: score.totalPoints,
      excelTotal,
      delta,
      absoluteDelta,
      tolerance,
      status: 'explained',
      explanationCode: 'sportos_bonus_excluded_from_excel',
      likelyRuleCodes: ledgerRuleCodes(score, input.rules, 'bonus'),
      activityTypes,
      componentResults,
      score,
    };
  }

  if (tolerance > 0 && absoluteDelta <= tolerance) {
    return {
      date: input.facts.metricDate,
      appTotal: score.totalPoints,
      excelTotal,
      delta,
      absoluteDelta,
      tolerance,
      status: 'explained',
      explanationCode: 'source_rounding_tolerance',
      likelyRuleCodes: roundedRuleCodes(score),
      activityTypes,
      componentResults,
      score,
    };
  }

  return {
    date: input.facts.metricDate,
    appTotal: score.totalPoints,
    excelTotal,
    delta,
    absoluteDelta,
    tolerance,
    status: 'unresolved',
    explanationCode: 'unresolved_delta',
    likelyRuleCodes: mismatchRuleCodes(componentResults),
    activityTypes,
    componentResults,
    score,
  };
}

function reconcileComponents(
  score: DailyScoreResult,
  rules: ScoringRule[],
  evidence: SpreadsheetScoreComponentEvidence[],
): ComponentReconciliationResult[] {
  const ruleByCode = new Map(rules.map((rule) => [rule.code, rule]));
  return evidence
    .map((component) => {
      const entries = score.ledger.filter((entry) => {
        if (entry.calculationJson.classification !== 'base') return false;
        const rule = entry.ruleCode ? ruleByCode.get(entry.ruleCode) : undefined;
        return rule?.activityType === component.activityType;
      });
      const appBasePoints = entries.reduce((sum, entry) => sum + entry.points, 0);
      const ruleCodes = [...new Set(entries
        .map((entry) => entry.ruleCode)
        .filter((code): code is string => typeof code === 'string'))]
        .sort();
      const delta = appBasePoints - component.importedPoints;
      const tolerance = explicitTolerance(component.roundingUnit);
      const status: ComponentReconciliationStatus = ruleCodes.length === 0
        ? 'unmapped'
        : delta === 0
          ? 'exact'
          : tolerance > 0 && Math.abs(delta) <= tolerance
            ? 'within_tolerance'
            : 'mismatch';
      return {
        activityType: component.activityType,
        sourceColumn: component.sourceColumn,
        importedPoints: component.importedPoints,
        appBasePoints,
        delta,
        tolerance,
        status,
        ruleCodes,
      };
    })
    .sort((a, b) => a.sourceColumn.localeCompare(b.sourceColumn));
}

function collectActivityTypes(
  score: DailyScoreResult,
  rules: ScoringRule[],
  evidence: SpreadsheetScoreComponentEvidence[],
): ActivityType[] {
  const ruleByCode = new Map(rules.map((rule) => [rule.code, rule]));
  const activityTypes = new Set<ActivityType>(evidence.map((component) => component.activityType));
  for (const entry of score.ledger) {
    const rule = entry.ruleCode ? ruleByCode.get(entry.ruleCode) : undefined;
    if (rule) activityTypes.add(rule.activityType);
  }
  return [...activityTypes].sort();
}

function ledgerRuleCodes(
  score: DailyScoreResult,
  rules: ScoringRule[],
  classification: 'base' | 'bonus',
): string[] {
  const knownCodes = new Set(rules.map((rule) => rule.code));
  return [...new Set(score.ledger
    .filter((entry) => entry.calculationJson.classification === classification)
    .map((entry) => entry.ruleCode)
    .filter((code): code is string => typeof code === 'string' && knownCodes.has(code)))]
    .sort();
}

function roundedRuleCodes(score: DailyScoreResult): string[] {
  return [...new Set(score.ledger
    .filter((entry) => {
      const rawPoints = entry.calculationJson.rawPoints;
      const roundedPoints = entry.calculationJson.roundedPoints;
      return typeof rawPoints === 'number' && typeof roundedPoints === 'number' && rawPoints !== roundedPoints;
    })
    .map((entry) => entry.ruleCode)
    .filter((code): code is string => typeof code === 'string'))]
    .sort();
}

function mismatchRuleCodes(componentResults: ComponentReconciliationResult[]): string[] {
  return [...new Set(componentResults
    .filter((component) => component.status === 'mismatch')
    .flatMap((component) => component.ruleCodes))]
    .sort();
}

function explicitTolerance(roundingUnit: number | undefined): number {
  return roundingUnit !== undefined && Number.isFinite(roundingUnit) && roundingUnit > 0
    ? roundingUnit / 2
    : 0;
}

function magnitudeBucket(absoluteDelta: number | null): string {
  if (absoluteDelta === null) return 'not_comparable';
  if (absoluteDelta === 0) return 'exact';
  if (absoluteDelta <= 1) return '0_to_1';
  if (absoluteDelta <= 10) return '1_to_10';
  if (absoluteDelta <= 100) return '10_to_100';
  if (absoluteDelta <= 1000) return '100_to_1000';
  return 'over_1000';
}

function groupRows(
  rows: ScoreReconciliationRow[],
  keysForRow: (row: ScoreReconciliationRow) => string[],
): ReconciliationGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const key of [...new Set(keysForRow(row))]) {
      const dates = groups.get(key) ?? new Set<string>();
      dates.add(row.date);
      groups.set(key, dates);
    }
  }
  return [...groups.entries()]
    .map(([key, dates]) => ({ key, count: dates.size, dates: [...dates].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
