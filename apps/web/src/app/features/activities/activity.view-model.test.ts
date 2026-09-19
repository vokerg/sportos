import { describe, expect, it } from 'vitest';
import type { Activity } from './activities-api.service';
import { metrics, TYPE_OPTIONS } from './activity.view-model';

const base: Activity = {
  id: '1', activity_date: '2026-01-01', start_time: null, activity_type: 'run', subtype: null,
  source: 'strava', source_activity_id: null, distance_m: 5000, duration_s: 1500, moving_time_s: null,
  steps: null, calories: null, avg_hr: 145, max_hr: null, elevation_gain_m: null,
  avg_speed_mps: null, avg_pace_s_per_km: 300, effort_points: null, notes: null,
};

describe('activity presentation', () => {
  it('covers every canonical type without generic empty metrics', () => {
    expect(TYPE_OPTIONS.map((option) => option.value)).toEqual(['', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'steps', 'bonus']);
    expect(metrics(base).map((metric) => metric.label)).toEqual(['Distance', 'Duration', 'Average pace', 'Average HR']);
    expect(metrics({ ...base, activity_type: 'bike', avg_speed_mps: 8, avg_pace_s_per_km: null }).map((metric) => metric.label))
      .toEqual(['Distance', 'Duration', 'Average speed', 'Average HR']);
    expect(metrics({ ...base, activity_type: 'workout', distance_m: null, avg_pace_s_per_km: null, calories: 300 }).map((metric) => metric.label))
      .toEqual(['Duration', 'Average HR', 'Calories']);
  });
});
