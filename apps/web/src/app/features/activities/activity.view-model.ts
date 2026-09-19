import type { Activity, ActivityType } from './activities-api.service';

export const TYPE_OPTIONS: Array<{ value: ActivityType | ''; label: string }> = [
  { value: '', label: 'All types' }, { value: 'run', label: 'Run' }, { value: 'bike', label: 'Bike' },
  { value: 'swim', label: 'Swim' }, { value: 'workout', label: 'Workout' }, { value: 'rowing', label: 'Rowing' },
  { value: 'sup', label: 'SUP' }, { value: 'hiit', label: 'HIIT' }, { value: 'steps', label: 'Steps' },
  { value: 'bonus', label: 'Bonus' },
];
export const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' }, { value: 'manual', label: 'Manual' },
  { value: 'my_sport_xlsx', label: 'My Sport workbook' }, { value: 'run_db_xlsx', label: 'Run DB workbook' },
  { value: 'google_sheets', label: 'Google Sheets' }, { value: 'strava', label: 'Strava' },
  { value: 'garmin', label: 'Garmin' }, { value: 'fit', label: 'FIT' },
] as const;

export function title(activity: Activity): string {
  return TYPE_OPTIONS.find((option) => option.value === activity.activity_type)?.label ?? activity.activity_type;
}
export function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
}
export function distance(metres: number): string {
  return `${(metres / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} km`;
}
export function pace(secondsPerKm: number): string {
  const seconds = Math.round(secondsPerKm);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} /km`;
}
export function startTime(value: string | null): string | null {
  return value ? new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;
}
export interface Metric { label: string; value: string }
export function metrics(activity: Activity, detailed = false): Metric[] {
  const output: Metric[] = [];
  const add = (label: string, value: number | null, format: (value: number) => string) => {
    if (value !== null) output.push({ label, value: format(value) });
  };
  const isDistance = ['run', 'bike', 'swim', 'rowing', 'sup'].includes(activity.activity_type);
  if (isDistance) add('Distance', activity.distance_m, distance);
  add('Duration', activity.duration_s, duration);
  if (detailed) add('Moving time', activity.moving_time_s, duration);
  if (['run', 'swim'].includes(activity.activity_type)) add('Average pace', activity.avg_pace_s_per_km, pace);
  if (['bike', 'rowing', 'sup'].includes(activity.activity_type)) add('Average speed', activity.avg_speed_mps, (v) => `${(v * 3.6).toFixed(1)} km/h`);
  if (activity.activity_type !== 'bonus' && activity.activity_type !== 'steps') {
    add('Average HR', activity.avg_hr, (v) => `${v} bpm`);
    add('Max HR', activity.max_hr, (v) => `${v} bpm`);
  }
  if (['run', 'bike', 'rowing', 'sup'].includes(activity.activity_type)) add('Elevation gain', activity.elevation_gain_m, (v) => `${Math.round(v)} m`);
  if (detailed || !isDistance) add('Calories', activity.calories, (v) => `${v} kcal`);
  if (detailed || activity.activity_type === 'steps') add('Steps', activity.steps, (v) => v.toLocaleString('en-US'));
  if (detailed) add('Effort points', activity.effort_points, String);
  return output;
}
