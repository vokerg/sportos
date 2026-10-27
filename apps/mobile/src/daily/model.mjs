/** Read-only presentation helpers. All points and classifications originate in SportOS API responses. */
import { isCalendarDate } from '../ui/format.mjs';

const categories = {
  steps: 'Steps', run: 'Running', bike: 'Cycling', swim: 'Swimming',
  workout: 'Workout', rowing: 'Rowing', sup: 'SUP', hiit: 'HIIT',
  bonus: 'Bonus', unattributed: 'Unattributed',
};
export function dailySummaryPath(options = {}) {
  const params = [];
  if (options.from !== undefined) {
    if (!isCalendarDate(options.from)) throw new Error('Invalid from date');
    params.push('from=' + options.from);
  }
  if (options.to !== undefined) {
    if (!isCalendarDate(options.to)) throw new Error('Invalid to date');
    params.push('to=' + options.to);
  }
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10000)
      throw new Error('Invalid limit');
    params.push('limit=' + options.limit);
  }
  return '/daily/summary' + (params.length ? '?' + params.join('&') : '');
}
export function scoreBreakdownPath(date) {
  if (!isCalendarDate(date)) throw new Error('Invalid score date');
  return '/daily/' + date + '/score-breakdown';
}
export function formatPoints(value, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const text = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  return signed && value > 0 ? '+' + text : text;
}
export function scoreAuthority(value) {
  return value === 'imported' ? 'Imported score'
    : value === 'manual' ? 'Manual edit'
    : value === 'calculated' ? 'Calculated score' : 'Unknown authority';
}
export function contributionRows(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return Object.entries(categories)
    .filter(([key]) => typeof values[key] === 'number' && Number.isFinite(values[key]))
    .map(([key, label]) => ({ key, label, points: values[key] }));
}
export function mergeDays(existing, older) {
  const map = new Map();
  for (const row of [...existing, ...older]) {
    if (row && isCalendarDate(row.metric_date) && !map.has(row.metric_date)) map.set(row.metric_date, row);
  }
  return [...map.values()].sort((a, b) => b.metric_date.localeCompare(a.metric_date));
}
export function todayCoverage(date, today) {
  return date === today ? 'Today is incomplete — provider updates and recalculation may be pending.'
    : date < today ? 'Latest persisted record; newer days may have no score yet.'
    : 'Future date — no persisted score expected.';
}
export function sourceNames(sources) {
  if (!sources) return 'Provider coverage not reported';
  const names = [];
  if (sources.strava) names.push('Strava');
  if (sources.garmin) names.push('Garmin');
  return names.length ? 'Evidence: ' + names.join(' + ') : 'No linked provider evidence reported';
}
export function safeActivityType(value) {
  const names = { steps: 'Steps', walk: 'Walk', run: 'Run', bike: 'Ride',
    swim: 'Swim', workout: 'Workout', rowing: 'Rowing', sup: 'SUP',
    hiit: 'HIIT', bonus: 'Bonus' };
  return names[value] ?? 'Activity';
}
