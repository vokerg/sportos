import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import type { RuleProposal, RuleVersion } from './features/rules/model/rules.models';
import {
  cleanRuleProposal,
  metricOptionsFor,
  metricUnit,
  newRuleProposal,
  proposalFromRule,
  ruleFormula,
  signedRuleDelta,
  updateProposalActivity,
  updateProposalRuleKind,
} from './rules-studio.view-model';

const coefficientRule: RuleVersion = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  supersedesRuleId: null,
  code: 'run.km.default',
  name: 'Run coefficient',
  activityType: 'run',
  ruleKind: 'coefficient',
  metric: 'distance_km',
  coefficient: 1000,
  validFrom: '1900-01-01',
  validTo: '2026-05-17',
  priority: 20,
  enabled: true,
  description: ' Current rule. ',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Rules Studio view model', () => {
  it('derives the default and superseding coefficient proposals without changing rule identity', () => {
    expect(newRuleProposal('2026-09-14')).toEqual({
      code: 'run.distance.custom',
      name: 'Custom run distance',
      activityType: 'run',
      ruleKind: 'coefficient',
      metric: 'distance_km',
      coefficient: 1000,
      validFrom: '2026-09-14',
      priority: 100,
    });

    expect(proposalFromRule(coefficientRule, '2026-05-18')).toEqual(expect.objectContaining({
      replaceRuleId: coefficientRule.id,
      code: coefficientRule.code,
      ruleKind: 'coefficient',
      coefficient: 1000,
      validFrom: '2026-05-18',
      validTo: undefined,
    }));
  });

  it('keeps activity metric choices explicit and synchronizes achievement units on activity changes', () => {
    expect(metricOptionsFor('run')).toEqual([
      'distance_m',
      'distance_km',
      'duration_s',
      'pace_s_per_km',
      'avg_speed_mps',
      'avg_speed_kmh',
    ]);
    expect(metricOptionsFor('bike')).not.toContain('pace_s_per_km');
    expect(metricOptionsFor('steps')).toEqual(['steps']);
    expect(metricOptionsFor('workout')).toEqual(['effort_points']);

    const achievement: RuleProposal = {
      code: 'run.pace.fast',
      name: 'Fast pace',
      activityType: 'run',
      ruleKind: 'achievement',
      metric: 'pace_s_per_km',
      thresholdOperator: 'lt',
      thresholdValue: 240,
      thresholdUnit: 's/km',
      points: 4000,
      validFrom: '2026-05-18',
      priority: 50,
    };

    expect(updateProposalActivity(achievement, 'bike')).toEqual(expect.objectContaining({
      activityType: 'bike',
      metric: 'distance_m',
      thresholdUnit: 'm',
    }));

    expect(updateProposalActivity(newRuleProposal('2026-09-14'), 'steps')).toEqual(expect.objectContaining({
      activityType: 'steps',
      metric: 'steps',
      thresholdUnit: 'steps',
    }));
  });

  it('derives representative achievement and coefficient form state without scoring in Angular', () => {
    const coefficient = newRuleProposal('2026-09-14');
    const achievement = updateProposalRuleKind(coefficient, 'achievement');

    expect(achievement).toEqual(expect.objectContaining({
      ruleKind: 'achievement',
      coefficient: undefined,
      thresholdOperator: 'gte',
      thresholdValue: 0,
      thresholdUnit: 'km',
      points: 1,
    }));

    const restored = updateProposalRuleKind(achievement, 'coefficient');
    expect(restored).toEqual(expect.objectContaining({
      ruleKind: 'coefficient',
      coefficient: 1,
      thresholdOperator: undefined,
      thresholdValue: undefined,
      thresholdUnit: undefined,
      points: undefined,
    }));
  });

  it('formats rule formulas and cleans optional proposal fields for API submission', () => {
    expect(metricUnit('pace_s_per_km')).toBe('s/km');
    expect(ruleFormula(coefficientRule)).toBe('× 1000');
    expect(ruleFormula({
      ruleKind: 'achievement',
      thresholdOperator: 'lt',
      thresholdValue: 240,
      thresholdUnit: 's/km',
      points: 4000,
      pointsMultiplier: 'completed_5k_blocks',
    })).toBe('lt 240 s/km → +4000 per completed 5 km');
    expect(ruleFormula({
      ruleKind: 'achievement',
      thresholdOperator: 'lte',
      thresholdValue: 240,
      thresholdUnit: 's/km',
      points: 4000,
      pointsMultiplier: 'rounded_5k_blocks',
    })).toBe('lte 240 s/km → +4000 per rounded 5 km (pace rounded favourably)');
    expect(signedRuleDelta(1000)).toBe('+1000');
    expect(signedRuleDelta(-250)).toBe('-250');

    expect(cleanRuleProposal({
      ...newRuleProposal('2026-09-14'),
      validTo: '',
      description: '  Updated coefficient.  ',
    })).toEqual(expect.objectContaining({
      validTo: undefined,
      description: 'Updated coefficient.',
    }));
  });
});
