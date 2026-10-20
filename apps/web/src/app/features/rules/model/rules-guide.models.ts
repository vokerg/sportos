import type { ActivityType, RuleVersion } from './rules.models';

const activities: Array<{ type: ActivityType; title: string }> = [
  { type: 'run', title: 'Running' }, { type: 'swim', title: 'Swimming' },
  { type: 'bike', title: 'Cycling' }, { type: 'steps', title: 'Daily steps' },
  { type: 'workout', title: 'Strength & workouts' }, { type: 'bonus', title: 'Manual bonus' },
  { type: 'rowing', title: 'Rowing' }, { type: 'sup', title: 'Paddleboarding' }, { type: 'hiit', title: 'HIIT' },
];

export function ruleStatus(rule: RuleVersion, date: string): string {
  if (!rule.enabled) return 'Inactive';
  if (rule.validFrom > date) return 'Scheduled';
  if (rule.validTo && rule.validTo < date) return 'Past';
  return 'Current';
}

export function rulesGuideGroups(rules: RuleVersion[], date: string) {
  const current = rules.filter(rule => ruleStatus(rule, date) === 'Current');
  return activities.map(activity => {
    const ordered = current.filter(rule => rule.activityType === activity.type)
      .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
    const base = ordered.filter(rule => rule.ruleKind !== 'achievement');
    // Keep independent/custom achievement groups distinct; only tiers within one
    // group share qualification notes and the highest-tier selection policy.
    const groups = new Map<string, RuleVersion[]>();
    for (const rule of ordered.filter(rule => rule.ruleKind === 'achievement')) {
      const key = rule.achievementGroup || rule.id;
      groups.set(key, [...(groups.get(key) ?? []), rule]);
    }
    const bonuses = [...groups.entries()].map(([id, tiers]) => ({
      id, tiers, notes: [...new Set(tiers.flatMap(rule => rule.guide.notes))],
      example: tiers[0]?.guide.example,
    }));
    return { ...activity, base, bonuses };
  }).filter(group => group.base.length || group.bonuses.length);
}
