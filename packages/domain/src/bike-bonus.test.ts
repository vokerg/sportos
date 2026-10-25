import { describe, expect, it } from 'vitest';
import { scoreActivityWithRule, scoreDay } from './scoring.js';
import { describeScoringRule } from './rule-guide.js';
import { validateRuleProposal } from './rules-studio.js';
import type { ActivityFact, ScoringRule } from './types.js';

const date = '2094-05-18';
const rule: ScoringRule = {
  id: 'bike-block-version', code: 'bike.10k.easy.bonus', name: 'Bike speed bonus per 10 km',
  activityType: 'bike', ruleKind: 'achievement', metric: 'avg_speed_kmh',
  thresholdOperator: 'gte', thresholdValue: 19.9, thresholdUnit: 'km/h', points: 1000,
  pointsMultiplier: 'completed_10k_blocks', validFrom: '1900-01-01', priority: 100, enabled: true,
};
const ride = (overrides: Partial<ActivityFact> = {}): ActivityFact => ({
  id: 'ride', activityDate: date, activityType: 'bike', distanceM: 30_000,
  avgSpeedMps: 24 / 3.6, ...overrides,
});

describe('cycling bonus per completed 10 km', () => {
  it.each([[9999.9, 0], [10_000, 1000], [19_999.9, 1000], [20_000, 2000],
    [29_999.9, 2000], [30_000, 3000], [30_700, 3000], [40_000, 4000]])(
    'awards %s metres %s bonus points without rounding', (distanceM, points) => {
      expect(scoreActivityWithRule(ride({ distanceM }), rule, date)?.points ?? 0).toBe(points);
    });

  it('records exact rule, distance, block count and speed in the explanation', () => {
    const result = scoreActivityWithRule(ride(), rule, date)!;
    expect(result).toMatchObject({ ruleId: rule.id, activityId: 'ride', points: 3000,
      calculationJson: { configuredPoints: 1000, pointsMultiplier: 'completed_10k_blocks',
        multiplierInputValue: 30_000, multiplierValue: 3, awardedPoints: 3000,
        metricValue: 24, eligibilityRounding: null,
        auxiliaryConditions: [{ metric: 'distance_m', expected: 10_000, actual: 30_000, passed: true }] } });
    expect(result.reason).toContain('3 completed 10 km blocks × 1000 = 3000');
  });

  it.each([[19.89, 0], [19.9, 3000], [20, 3000]])('preserves the %s km/h speed boundary', (speed, points) => {
    expect(scoreActivityWithRule(ride({ avgSpeedMps: speed / 3.6 }), rule, date)?.points ?? 0).toBe(points);
  });

  it.each([{ distanceM: undefined }, { distanceM: 0 }, { distanceM: -1 }, { distanceM: NaN },
    { distanceM: Infinity }, { avgSpeedMps: undefined }, { avgSpeedMps: NaN }, { avgSpeedMps: Infinity }])(
    'rejects missing or invalid inputs %j', overrides => {
      expect(scoreActivityWithRule(ride(overrides), rule, date)).toBeNull();
    });

  it('counts blocks per ride and leaves base cycling points unchanged', () => {
    const activities = [ride({ id: 'a', distanceM: 15_000 }), ride({ id: 'b', distanceM: 15_000 })];
    const base: ScoringRule = { ...rule, id: 'base', code: 'bike.km.default', ruleKind: 'coefficient',
      metric: 'distance_km', coefficient: 650, pointsMultiplier: undefined };
    const facts = { metricDate: date, steps: 0, runM: 0, bikeM: 30_000, swimM: 0, workoutPoints: 0, bonusPoints: 0 };
    const result = scoreDay(facts, activities, [base, rule]);
    expect(result).toMatchObject({ basePoints: 19_500, bonusPoints: 2000, totalPoints: 21_500 });
    expect(result.ledger.filter(l => l.ruleId === rule.id).map(l => [l.activityId, l.points])).toEqual([['a', 1000], ['b', 1000]]);
    expect(scoreDay(facts, [ride({ distanceM: 5000 }), ride({ id: 'b', distanceM: 5000 })], [rule]).bonusPoints).toBe(0);
  });

  it('preserves historical flat bonuses and enabled/effective periods', () => {
    expect(scoreActivityWithRule(ride(), { ...rule, pointsMultiplier: undefined }, date)?.points).toBe(1000);
    expect(scoreActivityWithRule(ride(), { ...rule, enabled: false }, date)).toBeNull();
    expect(scoreActivityWithRule(ride(), { ...rule, validFrom: '2095-01-01' }, date)).toBeNull();
    expect(scoreActivityWithRule(ride(), { ...rule, validTo: '2093-12-31' }, date)).toBeNull();
  });

  it('validates only the supported bike achievement shape', () => {
    expect(validateRuleProposal(rule).pointsMultiplier).toBe('completed_10k_blocks');
    for (const change of [{ activityType: 'run' }, { metric: 'distance_km' }, { code: 'bike.custom' },
      { thresholdOperator: 'lt' }, { achievementGroup: 'bike.speed' }]) {
      expect(() => validateRuleProposal({ ...rule, ...change } as ScoringRule)).toThrow();
    }
  });

  it('explains current blocks and historical flat rules accurately', () => {
    expect(describeScoringRule(rule)).toMatchObject({ award: '+1,000 per completed 10 km',
      example: '30 km completes three 10 km blocks: 3 × 1,000 = 3,000 bonus points.' });
    expect(describeScoringRule(rule).notes.join(' ')).toContain('0.1 km/h tolerance');
    expect(describeScoringRule({ ...rule, pointsMultiplier: undefined }).award).toBe('+1,000 points per activity');
  });
});
