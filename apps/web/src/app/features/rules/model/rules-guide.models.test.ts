import { describe, expect, it } from 'vitest';
import { rulesGuideGroups, ruleStatus } from './rules-guide.models';
import type { RuleVersion } from './rules.models';
const rule = (overrides: Partial<RuleVersion> = {}): RuleVersion => ({
  id: 'current', code: 'swim.1k.sub20.bonus', name: 'Swim', activityType: 'swim',
  version: 1, supersedesRuleId: null, enabled: true, validFrom: '2026-01-01', priority: 90,
  createdAt: '2026-01-01', ruleKind: 'achievement', metric: 'moving_pace_s_per_km',
  achievementGroup: 'swim.pace.1k', guide: { label: 'Faster than 20:00/km', award: '+2,000 per completed km', notes: ['Highest tier only'] },
  ...overrides,
});

describe('read-only rule guide grouping', () => {
  it('shows only enabled versions effective on the local date', () => {
    const current = rule();
    const future = rule({ id: 'future', validFrom: '2027-01-01' });
    const past = rule({ id: 'past', validTo: '2026-10-19' });
    const inactive = rule({ id: 'inactive', enabled: false });
    expect([current, future, past, inactive].map(r => ruleStatus(r, '2026-10-20'))).toEqual(['Current','Scheduled','Past','Inactive']);
    expect(rulesGuideGroups([current,future,past,inactive], '2026-10-20')[0].bonuses[0].tiers).toEqual([current]);
    expect(ruleStatus(rule({ validTo: '2026-10-20' }), '2026-10-20')).toBe('Current');
  });
  it('orders tiers and deduplicates their notes without mixing independent groups', () => {
    const lowest = rule();
    const fastest = rule({ id: 'fast', priority: 93 });
    const separate = rule({ id: 'custom', achievementGroup: 'swim.custom' });
    const groups = rulesGuideGroups([fastest, separate, lowest], '2026-10-20');
    expect(groups[0].bonuses).toHaveLength(2);
    const ladder = groups[0].bonuses.find(group => group.id === 'swim.pace.1k')!;
    expect(ladder.tiers.map(r => r.id)).toEqual(['current', 'fast']);
    expect(ladder.notes).toEqual(['Highest tier only']);
  });
  it('keeps base rules separate and presents exact server-supplied descriptions', () => {
    const base = rule({ id: 'base', ruleKind: 'coefficient', guide: { label: 'Base', award: '7.5 points per metre', notes: [] } });
    const groups = rulesGuideGroups([base, rule()], '2026-10-20');
    expect(groups[0].base).toEqual([base]);
    expect(groups[0].bonuses[0].tiers[0].guide.award).toBe('+2,000 per completed km');
    expect(rulesGuideGroups([], '2026-10-20')).toEqual([]);
  });
});
