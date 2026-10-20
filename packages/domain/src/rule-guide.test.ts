import { describe, expect, it } from 'vitest';
import { describeScoringRule } from './rule-guide.js';
import { confirmedSubtypeCoefficient } from './scoring.js';
import type { ScoringRule } from './types.js';

const swim: ScoringRule = {
  code: 'swim.1k.sub20.bonus', name: 'Swim', activityType: 'swim', ruleKind: 'achievement',
  metric: 'moving_pace_s_per_km', thresholdOperator: 'lt', thresholdValue: 1200,
  points: 2000, achievementGroup: 'swim.pace.1k', pointsMultiplier: 'completed_1k_blocks',
  validFrom: '1900-01-01', priority: 90, enabled: true,
};

describe('read-only rule descriptions', () => {
  it('explains strict swim pace, whole kilometres, exclusive tiers and missing time', () => {
    const description = describeScoringRule(swim);
    expect(description).toMatchObject({ label: 'Faster than 20:00/km', award: '+2,000 per completed km',
      example: '2 completed km × 2,000 tier points = 4,000 bonus points.' });
    expect(description.notes.join(' ')).toContain('Only the highest qualifying tier');
    expect(description.notes.join(' ')).toContain('not rounded');
    expect(description.notes.join(' ')).toContain('Missing moving time earns no bonus');
    expect(description.notes.join(' ')).toContain('at least 1,000 metres');
    expect(swim.pointsMultiplier).toBe('completed_1k_blocks');
  });

  it('preserves historical once-per-swim and elapsed semantics and renders custom points', () => {
    const old = describeScoringRule({ ...swim, pointsMultiplier: undefined, metric: 'pace_s_per_km' });
    expect(old.award).toBe('+2,000 points per activity');
    expect(old.example).toBeUndefined();
    expect(old.notes.join(' ')).toContain('elapsed time');
    expect(describeScoringRule({ ...swim, thresholdValue: 1170, points: 3500 })).toMatchObject({
      label: 'Faster than 19:30/km', award: '+3,500 per completed km',
    });
  });

  it('explains favourable run rounding without applying it to swimming', () => {
    const run = describeScoringRule({ ...swim, code: 'run.custom', activityType: 'run',
      metric: 'pace_s_per_km', thresholdOperator: 'lte', thresholdValue: 264,
      achievementGroup: 'run.pace.per5k', pointsMultiplier: 'rounded_5k_blocks' });
    expect(run.label).toBe('At or faster than 4:24/km');
    expect(run.award).toBe('+2,000 per completed 5 km');
    expect(run.notes.join(' ')).toContain('nearest 0.1 km');
    expect(run.notes.join(' ')).toContain('elapsed time');
  });

  it.each(['run', 'bike'] as const)('uses authoritative %s subtype coefficients and configured fallback', activityType => {
    const rule: ScoringRule = { ...swim, code: `${activityType}.km.default`, activityType,
      ruleKind: 'coefficient', metric: 'distance_km', coefficient: 987 };
    const guide = describeScoringRule(rule);
    const outdoor = confirmedSubtypeCoefficient(rule, { subtype: 'outdoor' })!;
    expect(guide.notes.join(' ')).toContain(`Outdoor: ${outdoor.toLocaleString('en-US')} points per km`);
    expect(guide.notes.join(' ')).toContain('Unspecified type: 987 points per km');
  });

  it('explains bike auxiliary distance, base swim units, sets and manual overrides', () => {
    expect(describeScoringRule({ ...swim, code: 'bike.10k.easy.bonus', activityType: 'bike',
      metric: 'avg_speed_kmh', thresholdOperator: 'gte', thresholdValue: 19.9,
      pointsMultiplier: undefined, achievementGroup: undefined }).notes.join(' ')).toContain('at least 10 km');
    expect(describeScoringRule({ ...swim, code: 'swim.m.default', ruleKind: 'coefficient', metric: 'distance_m', coefficient: 7.5 }).award).toBe('7.5 points per metre');
    expect(describeScoringRule({ ...swim, code: 'workout.points', ruleKind: 'manual_points', coefficient: 1 }).notes.join(' ')).toContain('1,000 points per 3 sets');
    expect(describeScoringRule({ ...swim, code: 'bonus.manual', ruleKind: 'manual_points', activityType: 'bonus', coefficient: 1 }).notes.join(' ')).toContain('explicitly recalculate');
  });
});
