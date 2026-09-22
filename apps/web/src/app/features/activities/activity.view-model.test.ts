import { describe, expect, it } from 'vitest';
import type { Activity } from './activities-api.service';
import { duration, metricGroups, metrics, TYPE_OPTIONS, RUN_PACE_OPTIONS, RUN_SUBTYPE_OPTIONS, quickRangeDates, matchQuickRange } from './activity.view-model';

const base: Activity = {
  id: '1', activity_date: '2026-01-01', start_time: null, activity_type: 'run', subtype: null,
  source: 'strava', source_activity_id: null, distance_m: 5000, duration_s: 1500, moving_time_s: null,
  steps: null, calories: null, avg_hr: 145, max_hr: null, elevation_gain_m: null,
  avg_speed_mps: null, avg_pace_s_per_km: 300, effort_points: null, notes: null,
};

describe('activity presentation', () => {
  it('covers every canonical type without generic empty metrics', () => {
    expect(TYPE_OPTIONS.map((option) => option.value)).toEqual(['', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'steps', 'bonus']);
    expect(metrics(base).map((metric) => metric.label)).toEqual(['Distance', 'Elapsed time', 'Moving pace', 'Average HR']);
    expect(metrics({ ...base, activity_type: 'bike', avg_speed_mps: 8, avg_pace_s_per_km: null }).map((metric) => metric.label))
      .toEqual(['Distance', 'Elapsed time', 'Average speed', 'Average HR']);
    expect(metrics({ ...base, activity_type: 'workout', distance_m: null, avg_pace_s_per_km: null, calories: 300 }).map((metric) => metric.label))
      .toEqual(['Elapsed time', 'Average HR', 'Calories']);
  });

  it('shows second-precise Strava run measurements and omits duplicate moving time', () => {
    const run: Activity = { ...base, duration_s: 1190, moving_time_s: 1165, avg_pace_s_per_km: 233,
      avg_speed_mps: 4.3, avg_hr: 188, max_hr: 201, elevation_gain_m: 0, calories: 320, notes: 'Evening run' };
    expect(duration(run.duration_s!)).toBe('19:50');
    expect(metrics(run).map((metric) => `${metric.label}: ${metric.value}`)).toContain('Moving time: 19:25');
    expect(metrics(run).some((metric) => metric.label === 'Average speed')).toBe(false);
    expect(metricGroups(run).find((group) => group.title === 'Time and distance')?.items.map((metric) => `${metric.label}: ${metric.value}`))
      .toEqual(['Distance: 5 km', 'Elapsed time: 19:50', 'Moving time: 19:25', 'Stopped time: 0:25']);
    expect(metrics({ ...run, moving_time_s: 1190 }).some((metric) => metric.label === 'Moving time')).toBe(false);
  });

  it('uses swimming units for distance and pace', () => {
    const swim = { ...base, activity_type: 'swim' as const, distance_m: 500, avg_pace_s_per_km: 1200 };
    expect(metrics(swim).map((metric) => `${metric.label}: ${metric.value}`))
      .toContain('Moving pace: 2:00 /100 m');
    expect(metrics(swim)[0]).toMatchObject({ label: 'Distance', value: '500 m' });
  });

  it('offers the requested strict run pace cutoffs and calendar-aware quick ranges', () => {
    expect(RUN_PACE_OPTIONS.map((option) => option.value)).toEqual([0, 240, 252, 264, 300]);
    expect(RUN_SUBTYPE_OPTIONS.map((option) => option.value)).toEqual(['', 'treadmill', 'track', 'outdoor']);
    const today = new Date('2026-03-31T12:00:00.000Z');
    expect(quickRangeDates('1m', today)).toEqual({ from: '2026-02-28', to: '2026-03-31' });
    expect(quickRangeDates('all', today)).toEqual({ from: '', to: '' });
    expect(matchQuickRange('2026-02-28', '2026-03-31', today)).toBe('1m');
  });
});
