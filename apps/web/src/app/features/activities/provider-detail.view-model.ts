import type { FitMessage } from './activities-api.service';
const FIT_METRICS = new Set(['total_distance','total_elapsed_time','total_timer_time','total_calories','avg_heart_rate','max_heart_rate','avg_speed','enhanced_avg_speed','max_speed','avg_cadence','avg_running_cadence','avg_power','max_power','total_ascent','total_descent','avg_vertical_oscillation','avg_stance_time','avg_step_length','avg_vertical_ratio','avg_stance_time_balance','total_training_effect','total_anaerobic_training_effect']);
export function fitMetrics(message: FitMessage | undefined) {
  return (message?.fields ?? []).filter(field => FIT_METRICS.has(field.name) && typeof field.value === 'number' && Number.isFinite(field.value))
    .map(field => ({ label: field.name.replaceAll('_', ' '), value: `${Number(field.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${field.units ? ' ' + field.units : ''}` }));
}
export function stravaMetrics(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const value = payload as Record<string, unknown>;
  return ['average_cadence','average_watts','max_watts','weighted_average_watts','kilojoules','suffer_score','average_temp'].filter(key => typeof value[key] === 'number' && Number.isFinite(value[key])).map(key => ({ label: key.replaceAll('_',' '), value: String(value[key]) }));
}
export function exerciseSetRows(payload: unknown) {
  if (!payload || typeof payload !== 'object') return [];
  const rows = Array.isArray(payload) ? payload : (payload as Record<string, unknown>)['exerciseSets'];
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 100).filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row)).map(row => Object.entries(row)
    .filter(([, value]) => ['string','number','boolean'].includes(typeof value) && value !== null)
    .slice(0, 20).map(([name,value]) => ({ label: name.replace(/([A-Z])/g, ' $1').replaceAll('_',' ').trim(), value: String(value).slice(0, 160) })));
}
