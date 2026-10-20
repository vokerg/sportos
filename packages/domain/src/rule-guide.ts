import { confirmedSubtypeCoefficient } from './scoring.js';
import { workoutPointsFromSets } from './garmin-strength.js';
import type { ScoringRule } from './types.js';

/** Read-only descriptions of rule semantics, never a second scoring engine. */
export interface RuleGuide {
  label: string;
  award: string;
  notes: string[];
  example?: string;
}

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 4 });
const units: Record<string, string> = {
  steps: 'step', distance_m: 'metre', distance_km: 'kilometre', duration_s: 'second',
  effort_points: 'recorded point', avg_speed_mps: 'm/s', avg_speed_kmh: 'km/h',
};

function pace(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round((seconds - minutes * 60) * 100) / 100;
  return `${minutes}:${remainder < 10 ? '0' : ''}${remainder}/km`;
}

export function describeScoringRule(rule: ScoringRule): RuleGuide {
  if (rule.ruleKind !== 'achievement') {
    const coefficient = rule.coefficient ?? (rule.ruleKind === 'manual_points' ? 1 : 0);
    const guide: RuleGuide = {
      label: rule.activityType === 'bonus' ? 'Manual bonus' : rule.ruleKind === 'manual_points' ? 'Recorded points' : 'Base points',
      award: `${number(coefficient)} ${coefficient === 1 ? 'point' : 'points'} per ${units[rule.metric] ?? rule.metric}`,
      notes: ['Rounded to the nearest whole point for each contribution.'],
    };
    if (rule.code === 'run.km.default' || rule.code === 'bike.km.default') {
      const subtypes = rule.code === 'run.km.default' ? ['outdoor', 'treadmill'] as const : ['outdoor', 'indoor'] as const;
      guide.award = 'Points per kilometre';
      guide.notes = subtypes.map(subtype => `${subtype[0]!.toUpperCase()}${subtype.slice(1)}: ${number(confirmedSubtypeCoefficient(rule, { subtype })!)} points per km.`);
      guide.notes.push(`Unspecified type: ${number(coefficient)} points per km.`,
        'Separate subtype rules take precedence. Contributions are rounded to whole points.');
    }
    if (rule.code === 'steps.base') guide.notes.unshift('When resolving total daily steps, estimated running steps are deducted to avoid counting running twice.');
    if (rule.code === 'workout.points') guide.notes.unshift(
      `Complete Garmin working sets earn ${number(workoutPointsFromSets(3))} points per 3 sets, rounded once across the day. Warm-up and rest sets do not count.`,
      'A positive manual entry takes priority; incomplete or missing set evidence preserves imported/stored workout points.');
    if (rule.code === 'bonus.manual') guide.notes.unshift('A manual bonus is replaced by rule-derived achievement bonuses when you explicitly recalculate the day.');
    if (rule.activitySubtype) guide.notes.push(`Applies to ${rule.activitySubtype} activities.`);
    return guide;
  }

  const value = rule.thresholdValue;
  const isPace = rule.metric === 'pace_s_per_km' || rule.metric === 'moving_pace_s_per_km';
  const threshold = value === undefined ? '' : isPace ? pace(value) : `${number(value)} ${units[rule.metric] ?? rule.thresholdUnit ?? ''}`;
  const comparisons: Record<string, string> = isPace
    ? { lt: 'Faster than', lte: 'At or faster than', gt: 'Slower than', gte: 'At or slower than', eq: 'Exactly', exists: 'Recorded pace' }
    : { lt: 'Below', lte: 'At most', gt: 'Above', gte: 'At least', eq: 'Exactly', exists: 'Recorded value' };
  const points = number(rule.points ?? 0);
  const guide: RuleGuide = {
    label: `${comparisons[rule.thresholdOperator ?? ''] ?? 'Threshold'} ${threshold}`.trim(),
    award: `+${points} points per activity`,
    notes: ['Each activity qualifies separately; distances from separate sessions are never combined.'],
  };
  if (rule.achievementGroup) guide.notes.push('Only the highest qualifying tier in this group applies to each activity.');
  if (isPace) guide.notes.push(rule.metric === 'moving_pace_s_per_km'
    ? 'Pace uses moving time divided by distance. Missing moving time earns no bonus.'
    : 'Pace uses elapsed time divided by distance, including stops.');
  if (rule.pointsMultiplier === 'completed_1k_blocks') {
    guide.award = `+${points} per completed km`;
    guide.notes.push('Count whole kilometres within each swim. Distance and pace are not rounded for eligibility.');
    guide.example = `2 completed km × ${points} tier points = ${number((rule.points ?? 0) * 2)} bonus points.`;
  } else if (rule.pointsMultiplier === 'rounded_5k_blocks' || rule.pointsMultiplier === 'completed_5k_blocks') {
    guide.award = `+${points} per completed 5 km`;
    guide.notes.push(rule.pointsMultiplier === 'rounded_5k_blocks'
      ? 'Distance rounds to the nearest 0.1 km and pace to the nearest 0.1 min/km (6 seconds). A rounded pace on the boundary qualifies.'
      : 'Count whole 5 km blocks. Distance is not rounded.');
    guide.example = `10 km completes two 5 km blocks: 2 × ${points} tier points = ${number((rule.points ?? 0) * 2)} bonus points.`;
  }
  if (rule.achievementGroup === 'swim.pace.1k' || rule.code === 'swim.1k.sub20.bonus') guide.notes.push('Each swim must be at least 1,000 metres.');
  if (rule.code === 'bike.10k.easy.bonus') {
    guide.notes.push('Each ride must be at least 10 km.');
    if (rule.metric === 'avg_speed_kmh' && rule.thresholdOperator === 'gte' && rule.thresholdValue === 19.9) {
      guide.notes.push('The 20 km/h target allows a 0.1 km/h tolerance.');
    }
  }
  // Historical distance-specific run rules are not the current universal ladder.
  if (rule.code === 'run.5k.sub25.bonus') guide.notes.push('Applies to runs within 500 metres of 5 km.');
  if (rule.code === 'run.10k.completed.bonus') guide.notes.push('Also requires an elapsed pace at or faster than 5:00/km.');
  if (rule.activitySubtype) guide.notes.push(`Applies to ${rule.activitySubtype} activities.`);
  return guide;
}
