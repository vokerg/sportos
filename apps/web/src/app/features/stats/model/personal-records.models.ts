export const RECORD_METRIC_LABELS = {
  score: 'Official score',
  steps: 'Steps',
  run: 'Running distance',
  bike: 'Cycling distance',
  swim: 'Swimming distance',
  workout: 'Workout points',
  bonus: 'Bonus points',
} as const;

export type RecordMetric = keyof typeof RECORD_METRIC_LABELS;

export interface DailyRecord {
  metric: RecordMetric;
  windowDays: 1 | 7 | 20 | 30 | 60 | 365;
  period: string;
  date: string;
  value: number;
  recordedDays: number;
}

export interface SportRecord {
  targetDistanceM: number;
  activityId: string | null;
  date: string;
  durationS: number;
  source?: 'excel' | 'strava' | 'garmin';
  distanceM?: number;
}

export interface PersonalRecordsResponse {
  through: string;
  daily: DailyRecord[];
  running: SportRecord[];
  cycling: SportRecord[];
  swimming: SportRecord[];
}

const POINTS = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const DISTANCE = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

export function recordDistance(metres: number, inMetres = false): string {
  return inMetres ? `${DISTANCE.format(metres)} m` : `${DISTANCE.format(metres / 1000)} km`;
}

export function dailyRecordValue(record: DailyRecord): string {
  const { metric, value, windowDays } = record;
  const suffix = windowDays === 1 ? '' : '/day';
  if (metric === 'run' || metric === 'bike' || metric === 'swim') {
    return recordDistance(value, metric === 'swim') + suffix;
  }
  const unit = metric === 'steps' ? 'steps' : 'pts';
  return `${POINTS.format(value)} ${unit}${suffix}`;
}
