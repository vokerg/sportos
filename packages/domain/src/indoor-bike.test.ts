import { describe, expect, it } from 'vitest';
import { scoreDay, scoreFromImportedLedger } from './scoring.js';
import { describeScoringRule } from './rule-guide.js';
import { proposalAsRule, validateRuleProposal, previewRuleChange } from './rules-studio.js';
import type { DailyMetricFacts, ScoringRule } from './types.js';

const date = '2026-11-16';
const old: ScoringRule = { id: '11111111-1111-4111-8111-111111111111', code: 'bike.km.default',
  name: 'Bike', activityType: 'bike', ruleKind: 'coefficient', metric: 'distance_km',
  coefficient: 650, validFrom: '1900-01-01', priority: 30, enabled: true };
const current = { ...old, id: '22222222-2222-4222-8222-222222222222', indoorBikeCoefficient: 750 };
const facts: DailyMetricFacts = { metricDate: date, steps: 0, runM: 0,
  bikeM: 10000, bikeIndoorM: 10000, bikeOutdoorM: 0, bikeUnspecifiedM: 0,
  swimM: 0, workoutPoints: 0, bonusPoints: 0 };

describe('versioned indoor cycling base points', () => {
  it('awards 7,500 for a 10 km provider ride and retains historical 7,000 semantics', () => {
    const activity = { id: 'ride', activityDate: date, activityType: 'bike' as const,
      subtype: 'indoor' as const, distanceM: 10000 };
    expect(scoreDay(facts, [activity], [old]).totalPoints).toBe(7000);
    const result = scoreDay(facts, [activity], [current]);
    expect(result).toMatchObject({ basePoints: 7500, bonusPoints: 0, totalPoints: 7500 });
    expect(result.ledger).toMatchObject([{ activityId: 'ride', ruleId: current.id,
      calculationJson: { coefficient: 750, configuredCoefficient: 650,
        appliedCoefficient: 750, coefficientSource: 'versioned_rule_subtype_semantics',
        sourceFormula: 'Indoor bike km × 750' } }]);
  });

  it('uses the same rate for manual splits, rounds once and preserves outdoor/unknown rates', () => {
    expect(scoreDay(facts, [], [current]).totalPoints).toBe(7500);
    const mixed = { ...facts, bikeM: 30001, bikeIndoorM: 10001, bikeOutdoorM: 10000, bikeUnspecifiedM: 10000 };
    const result = scoreDay(mixed, [], [current]);
    expect(result.ledger.map(entry => entry.points)).toEqual([7501, 6000, 6500]);
    expect(result.totalPoints).toBe(20001);
  });

  it('keeps speed achievements independent and imported totals authoritative', () => {
    const bonus: ScoringRule = { code: 'bike.10k.easy.bonus', name: 'Bike bonus',
      activityType: 'bike', ruleKind: 'achievement', metric: 'avg_speed_kmh',
      thresholdOperator: 'gte', thresholdValue: 19.9, thresholdUnit: 'km/h', points: 1000,
      pointsMultiplier: 'completed_10k_blocks', validFrom: '1900-01-01', priority: 100, enabled: true };
    const activity = { activityDate: date, activityType: 'bike' as const, subtype: 'indoor' as const,
      distanceM: 10000, avgSpeedMps: 20 / 3.6 };
    expect(scoreDay(facts, [activity], [current, bonus])).toMatchObject({
      basePoints: 7500, bonusPoints: 1000, totalPoints: 8500 });
    expect(scoreFromImportedLedger({ ...facts, excelAllPoints: 7000 }).totalPoints).toBe(7000);
  });

  it('describes historical and current rules accurately', () => {
    expect(describeScoringRule(old).notes).toContain('Indoor: 700 points per km.');
    expect(describeScoringRule(current).notes).toContain('Indoor: 750 points per km.');
  });

  it('preserves the versioned rate through proposal validation and previews', () => {
    const proposal = validateRuleProposal({ ...current, replaceRuleId: old.id, validFrom: date });
    expect(proposalAsRule(proposal).indoorBikeCoefficient).toBe(750);
    expect(previewRuleChange([{ facts, activities: [], currentBasePoints: 7000,
      currentBonusPoints: 0, currentTotalPoints: 7000, recomputedAt: '2026-11-16T00:00:00Z' }], [old], proposal))
      .toMatchObject({ changedDates: 1, aggregateDelta: 500 });
    expect(validateRuleProposal({ ...proposal, indoorBikeCoefficient: undefined }).indoorBikeCoefficient).toBe(750);
    for (const coefficient of [0, -1, NaN, Infinity]) {
      expect(() => validateRuleProposal({ ...proposal, indoorBikeCoefficient: coefficient })).toThrow();
    }
  });
});
