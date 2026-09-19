import type { Activity, ActivityType } from './activities-api.service';

export const TYPE_OPTIONS: Array<{ value: ActivityType | ''; label: string }> = [
  { value: '', label: 'All types' }, { value: 'run', label: 'Run' }, { value: 'bike', label: 'Bike' },
  { value: 'swim', label: 'Swim' }, { value: 'workout', label: 'Workout' }, { value: 'rowing', label: 'Rowing' },
  { value: 'sup', label: 'SUP' }, { value: 'hiit', label: 'HIIT' }, { value: 'steps', label: 'Steps' },
  { value: 'bonus', label: 'Bonus' },
];
export const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' }, { value: 'manual', label: 'Manual' },
  { value: 'my_sport_xlsx', label: 'My Sport workbook' }, { value: 'run_db_xlsx', label: 'Run DB workbook' },
  { value: 'google_sheets', label: 'Google Sheets' }, { value: 'strava', label: 'Strava' },
  { value: 'garmin', label: 'Garmin' }, { value: 'fit', label: 'FIT' },
] as const;

export const QUICK_RANGE_OPTIONS = [
  { value: 'custom', label: 'Custom range' }, { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' }, { value: '6m', label: '6 months' },
  { value: 'ytd', label: 'YTD' }, { value: '1y', label: '1 year' },
  { value: '3y', label: '3 years' }, { value: 'all', label: 'All time' },
] as const;
export type QuickRange = typeof QUICK_RANGE_OPTIONS[number]['value'];
export const DEFAULT_QUICK_RANGE: Exclude<QuickRange, 'custom'> = '3m';
export function isQuickRange(value: string): value is QuickRange {
  return QUICK_RANGE_OPTIONS.some((option) => option.value === value);
}
export const RUN_PACE_OPTIONS = [
  { value: 0, label: 'Any pace' }, { value: 240, label: 'Sub 4:00 /km' },
  { value: 252, label: 'Sub 4:12 /km' }, { value: 264, label: 'Sub 4:24 /km' },
  { value: 300, label: 'Sub 5:00 /km' },
] as const;
export const BIKE_SPEED_OPTIONS = [0, 20, 25, 30, 35] as const;
export const SWIM_PACE_OPTIONS = [
  { value: 0, label: 'Any pace' }, { value: 90, label: 'Sub 1:30 /100 m' },
  { value: 120, label: 'Sub 2:00 /100 m' }, { value: 150, label: 'Sub 2:30 /100 m' },
] as const;
export const DISTANCE_OPTIONS_M = {
  run: [0, 5000, 10000, 21000, 42000],
  bike: [0, 20000, 40000, 80000, 100000],
  swim: [0, 500, 1000, 1500, 2000],
} as const;

export function quickRangeDates(range: Exclude<QuickRange, 'custom'>, today = new Date()): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  if (range === 'all') return { from: '', to: '' };
  if (range === 'ytd') return { from: `${to.slice(0, 4)}-01-01`, to };
  const months = range === '1m' ? 1 : range === '3m' ? 3 : range === '6m' ? 6 : range === '1y' ? 12 : 36;
  const year = Number(to.slice(0, 4));
  const monthIndex = Number(to.slice(5, 7)) - 1 - months;
  const day = Number(to.slice(8, 10));
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return { from: `${targetYear.toString().padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`, to };
}

export function matchQuickRange(from: string, to: string, today = new Date()): QuickRange {
  for (const option of QUICK_RANGE_OPTIONS) {
    if (option.value === 'custom') continue;
    const dates = quickRangeDates(option.value as Exclude<QuickRange, 'custom'>, today);
    if (dates.from === from && dates.to === to) return option.value;
  }
  return 'custom';
}

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
