import { describe, expect, it } from 'vitest';
import { previewRuleChange, RuleProposalValidationError, validateRuleProposal, type RuleProposal } from './rules-studio.js';
import type { ScoringRule } from './types.js';

const existingRule: ScoringRule = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'run.distance.base',
  name: 'Run distance',
  activityType: 'run',
  ruleKind: 'coefficient',
  metric: 'distance_km',
  coefficient: 1000,
  validFrom: '2020-01-01',
  priority: 20,
  enabled: true,
};

const proposal: RuleProposal = {
  replaceRuleId: existingRule.id,
  code: existingRule.code,
  name: 'Run distance v2',
  activityType: 'run',
  ruleKind: 'coefficient',
  metric: 'distance_km',
  coefficient: 1200,
  validFrom: '2026-05-18',
  priority: 20,
  description: 'Explicit 20% coefficient change.',
};

describe('Rules Studio domain contract', () => {
  it('normalizes a valid proposal and preserves explicit effective boundaries', () => {
    expect(validateRuleProposal({ ...proposal, name: '  Run distance v2  ' })).toMatchObject({
      name: 'Run distance v2',
      validFrom: '2026-05-18',
      validTo: undefined,
      coefficient: 1200,
    });
  });

  it('rejects invalid metrics, dates, coefficients, and ranges together', () => {
    expect(() => validateRuleProposal({
      ...proposal,
      metric: 'steps',
      coefficient: 0,
      validFrom: '2026-02-30',
      validTo: '2026-01-01',
    })).toThrow(RuleProposalValidationError);

    try {
      validateRuleProposal({
        ...proposal,
        metric: 'steps',
        coefficient: 0,
        validFrom: '2026-02-30',
        validTo: '2026-01-01',
      });
    } catch (error) {
      const issues = (error as RuleProposalValidationError).issues;
      expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
        'INVALID_RULE_METRIC',
        'INVALID_COEFFICIENT',
        'INVALID_VALID_FROM',
        'INVALID_EFFECTIVE_RANGE',
      ]));
    }
  });

  it('requires achievement thresholds, matching units, and positive integer points', () => {
    expect(() => validateRuleProposal({
      code: 'run.fast.bonus',
      name: 'Fast run',
      activityType: 'run',
      ruleKind: 'achievement',
      metric: 'duration_s',
      thresholdOperator: 'lt',
      thresholdValue: 1500,
      thresholdUnit: 'minutes',
      points: 1.5,
      validFrom: '2026-01-01',
      priority: 80,
    })).toThrow(RuleProposalValidationError);
  });

  it('previews deterministic per-date and aggregate deltas without mutating current scores', () => {
    const preview = previewRuleChange([
      {
        facts: {
          metricDate: '2026-05-18',
          steps: 0,
          runM: 5000,
          bikeM: 0,
          swimM: 0,
          workoutPoints: 0,
          powerPoints: 0,
        },
        activities: [],
        currentBasePoints: 5000,
        currentBonusPoints: 0,
        currentTotalPoints: 5000,
        recomputedAt: '2026-07-31T08:00:00.000Z',
      },
      {
        facts: {
          metricDate: '2026-05-19',
          steps: 0,
          runM: 10000,
          bikeM: 0,
          swimM: 0,
          workoutPoints: 0,
          powerPoints: 0,
        },
        activities: [],
        currentBasePoints: 10000,
        currentBonusPoints: 0,
        currentTotalPoints: 10000,
        recomputedAt: '2026-07-31T08:00:00.000Z',
      },
    ], [existingRule], proposal);

    expect(preview).toMatchObject({
      affectedFrom: '2026-05-18',
      affectedTo: '2026-05-19',
      totalDates: 2,
      changedDates: 2,
      aggregateDelta: 3000,
      minimumDelta: 1000,
      maximumDelta: 2000,
    });
    expect(preview.rows.map((row) => row.proposedTotalPoints)).toEqual([6000, 12000]);
  });

  it('honors an inclusive valid-to boundary', () => {
    const preview = previewRuleChange([
      {
        facts: { metricDate: '2026-05-18', steps: 0, runM: 1000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
        activities: [], currentBasePoints: 1000, currentBonusPoints: 0, currentTotalPoints: 1000, recomputedAt: 'x',
      },
      {
        facts: { metricDate: '2026-05-19', steps: 0, runM: 1000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
        activities: [], currentBasePoints: 1000, currentBonusPoints: 0, currentTotalPoints: 1000, recomputedAt: 'x',
      },
    ], [existingRule], { ...proposal, validTo: '2026-05-18' });

    expect(preview.rows.map((row) => row.metricDate)).toEqual(['2026-05-18']);
  });
});
