import { formatDurationClock } from '../../../shared/util/duration';
import type { ActivityMetricComparison } from './activity-metrics.models';
import type { ActivityDetail } from '../activities-api.service';
import { metricGroups } from '../activity.view-model';
export const METRIC_GROUPS = ['Time & Distance', 'Heart Rate', 'Running Dynamics', 'Power & Training', 'Other'] as const;
export interface MetricValueView { value: number; text: string; sources: string[]; authoritative: boolean; fallback: boolean }
export interface MetricRowView { key: string; label: string; values: MetricValueView[] }
export interface MetricGroupView { title: typeof METRIC_GROUPS[number]; items: MetricRowView[] }

/** Absolute display tolerances in normalized units, never matching/scoring rules. */
export const METRIC_TOLERANCES: Readonly<Record<string, number>> = {
  distance: 10, elapsed_duration: 1, moving_duration: 1, timer_duration: 1,
  average_speed: 0.1 / 3.6, maximum_speed: 0.1 / 3.6, average_pace: 1,
  average_heart_rate: 1, maximum_heart_rate: 1, calories: 1, ascent: 1, descent: 1,
  average_temperature: 0.1, average_cadence: 1, running_cadence: 1, maximum_running_cadence: 1, maximum_cadence: 1,
  step_length: 0.01, vertical_oscillation: 0.1, vertical_ratio: 0.1, ground_contact_time: 1,
  ground_contact_balance: 0.1, stance_time_ratio: 0.1, average_power: 1, maximum_power: 1,
  weighted_average_power: 1, normalized_power: 1, total_work: 0.1,
  aerobic_training_effect: 0.1, anaerobic_training_effect: 0.1, relative_effort: 1, training_stress: 0.1,
  pool_length: 0.01, length_count: 0, active_length_count: 0, lap_count: 0, stroke_count: 0,
  stroke_rate: 1, strokes_per_length: 0.1, swolf: 0.1, distance_per_stroke: 0.01,
};
export function effectivelyEqual(key: string, a: number, b: number, sport: string): boolean {
  const tolerance = key === 'average_pace' && sport === 'swim' ? 10 : METRIC_TOLERANCES[key] ?? 0;
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance + Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}
const number = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
export function formatMetric(value: number, key: string, unit: string, sport: string): string {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (unit === 's') return formatDurationClock(value);
  if (unit === 's/km') {
    const seconds = Math.round(sport === 'swim' ? value / 10 : value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} ${sport === 'swim' ? '/100m' : '/km'}`;
  }
  if (unit === 'm/s') return `${(value * 3.6).toFixed(1)} km/h`;
  if (key === 'distance') return sport === 'swim' || value < 1000 ? `${number(value, 0)} m` : `${number(value / 1000, 3)} km`;
  if (key === 'step_length' || key === 'pool_length') return `${value.toFixed(2)} m`;
  if (unit === 'C') return `${number(value, 1)} °C`;
  const digits = ['%', 'mm', 'TE', 'tss', 'kJ', 'SWOLF', 'strokes/length'].includes(unit) ? 1 : unit === 'm/stroke' ? 2 : 0;
  return `${number(value, digits)} ${unit}`;
}
export function sourceLabel(source: string): string {
  return ({ strava: 'Strava', garmin: 'Garmin', manual: 'Manual', my_sport_xlsx: 'My Sport workbook', run_db_xlsx: 'Run DB workbook', google_sheets: 'Google Sheets', fit: 'FIT' } as Record<string, string>)[source] ?? source;
}
function valid(value: number, unit: string): boolean {
  return Number.isFinite(value) && (value >= 0 || unit === 'C') && (unit !== 'bpm' || value > 0);
}
/** API FIT running subfields are already steps/min. General run cadence rpm is
 * cycles/strides per minute for both providers; convert only this known unit. */
function runningCadence(metrics: readonly ActivityMetricComparison[], sport: string): ActivityMetricComparison[] {
  if (sport !== 'run') return [...metrics];
  const general = metrics.find(m => m.key === 'average_cadence' && m.unit === 'rpm');
  if (!general) return [...metrics];
  const explicit = metrics.find(m => m.key === 'running_cadence');
  const providersWithExplicit = new Set(explicit?.candidates.filter(c => c.selectedWithinProvider && valid(c.value, 'steps/min')).map(c => c.provider));
  const candidates = [...general.candidates.filter(c => !providersWithExplicit.has(c.provider)).map(c => ({ ...c, value: c.value * 2 })), ...(explicit?.candidates ?? [])];
  // Keep the same catalog priority, now comparing the same physical dimension.
  const strava = candidates.find(c => c.provider === 'strava' && c.selectedWithinProvider && valid(c.value, 'steps/min'));
  const selected = general.selected?.source === 'strava' && valid(general.selected.value, general.unit) ? { ...general.selected, value: general.selected.value * 2 }
    : strava ? { value: strava.value, source: 'strava', reason: 'provider_priority' as const }
    : explicit?.selected ?? (general.selected ? { ...general.selected, value: general.selected.value * 2 } : null);
  const merged = { ...general, key: 'running_cadence', label: 'Average running cadence', unit: 'steps/min', selected, candidates };
  return metrics.flatMap(m => m.key === 'average_cadence' ? [merged] : m.key === 'running_cadence' ? [] : [m]);
}
function groupFor(key: string): MetricGroupView['title'] {
  if (['distance','elapsed_duration','moving_duration','timer_duration','average_speed','maximum_speed','average_pace','ascent','descent','pool_length'].includes(key)) return 'Time & Distance';
  if (key.includes('heart_rate')) return 'Heart Rate';
  if (['running_cadence','maximum_running_cadence','step_length','vertical_oscillation','vertical_ratio','ground_contact_time','ground_contact_balance','stance_time_ratio'].includes(key)) return 'Running Dynamics';
  if (key.includes('power') || key.startsWith('strength_') || ['calories','total_work','aerobic_training_effect','anaerobic_training_effect','relative_effort','training_stress'].includes(key)) return 'Power & Training';
  return 'Other';
}
function valuesFor(metric: ActivityMetricComparison, sport: string): MetricValueView[] {
  const candidates = ['strava','garmin'].flatMap(provider => {
    const c = metric.candidates.find(c => c.provider === provider && c.selectedWithinProvider && valid(c.value, metric.unit));
    return c ? [c] : [];
  });
  const selected = metric.selected && valid(metric.selected.value, metric.unit) ? metric.selected : null;
  const fallback = !selected ? candidates.find(c => c.provider === 'garmin') : undefined;
  const preferred = selected ?? (fallback ? { value: fallback.value, source: 'garmin', reason: 'provider_priority' as const } : null);
  const rows: MetricValueView[] = [];
  const observations = new Map<MetricValueView, number[]>();
  if (preferred) rows.push({ value: preferred.value, text: '', sources: [sourceLabel(preferred.source)], authoritative: selected !== null, fallback: !!fallback });
  if (rows[0]) observations.set(rows[0], [rows[0].value]);
  for (const c of candidates) {
    // Agreement must hold for every member; tolerance is not transitive.
    const same = rows.find(r => observations.get(r)!.every(v => effectivelyEqual(metric.key, v, c.value, sport)));
    if (same) {
      if (!same.sources.includes(sourceLabel(c.provider))) same.sources.push(sourceLabel(c.provider));
      observations.get(same)!.push(c.value);
    } else {
      const row = { value: c.value, text: '', sources: [sourceLabel(c.provider)], authoritative: false, fallback: false };
      rows.push(row); observations.set(row, [c.value]);
    }
  }
  const rank = (r: MetricValueView) => r.sources.includes('Strava') ? 0 : r.sources.includes('Garmin') ? 1 : 2;
  return rows.sort((a,b) => rank(a) - rank(b)).map(r => ({ ...r, sources: r.sources.sort((a,b) => a === 'Strava' ? -1 : b === 'Strava' ? 1 : 0), text: formatMetric(r.value, metric.key, metric.unit, sport) }));
}
export function comparisonGroups(metrics: readonly ActivityMetricComparison[], sport: string): MetricGroupView[] {
  const rows = runningCadence(metrics, sport).map(m => ({ key: m.key, label: sport === 'bike' && m.key === 'average_cadence' ? 'Average cycling cadence' : m.label, values: valuesFor(m, sport) }));
  return METRIC_GROUPS.map(title => ({ title, items: rows.filter(m => groupFor(m.key) === title) })).filter(g => g.items.length > 0);
}

/** Keep canonical-only facts (including steps/effort/stopped time) visible without
 * repeating fields already rendered in the source comparison. Older APIs still
 * use the complete canonical cards when no comparison data is available. */
export function supplementalMetricGroups(activity: ActivityDetail) {
  const keys = new Set(activity.metricComparisons?.map(m => m.key) ?? []);
  const keyByLabel: Record<string, string> = {
    Distance: 'distance', Duration: 'elapsed_duration', 'Elapsed time': 'elapsed_duration',
    'Moving time': 'moving_duration', 'Moving pace': 'average_pace', 'Average pace': 'average_pace',
    'Average speed': 'average_speed', 'Average HR': 'average_heart_rate', 'Max HR': 'maximum_heart_rate',
    'Elevation gain': 'ascent', Calories: 'calories',
  };
  return metricGroups(activity).map(g => ({ ...g, items: g.items.filter(m => !keys.has(keyByLabel[m.label])) })).filter(g => g.items.length);
}
