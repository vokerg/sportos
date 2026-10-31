import { describe, expect, it } from 'vitest';
import { homeAverages, type HomeDay } from './home-summary';
const day = (date: string, steps = 1000): HomeDay => ({ metric_date: date, steps,
  total_points: 2000, run_m: 5000, bike_m: 0, swim_m: 0, workout_points: 0, bonus_points: 0 });
describe('home averages', () => {
  it('uses inclusive calendar boundaries and counts recorded zero days without inventing missing days', () => {
    const rows = [day('2026-10-01', 9000), day('2026-10-02'), day('2026-10-31', 0), day('2026-11-01', 9000)];
    expect(homeAverages(rows, '2026-10-02', '2026-10-31')).toMatchObject({ count: 2, steps: 500, score: 2000, run: 5000 });
  });
  it('normalizes decimal transport strings before addition', () => {
    const rows = [day('2026-10-30'), day('2026-10-31')].map(row => ({ ...row, run_m: '1250.50', bike_m: '20200.00', swim_m: '500.00' })) as unknown as HomeDay[];
    expect(homeAverages(rows, '2026-10-02', '2026-10-31')).toMatchObject({ run: 1250.5, bike: 20200, swim: 500 });
  });
  it('returns unavailable for missing or malformed metrics, preserving other metrics', () => {
    for (const value of [undefined, null, '', 'bad', NaN, Infinity]) {
      const row = { ...day('2026-10-31'), run_m: value } as unknown as HomeDay;
      expect(homeAverages([row], '2026-10-02', '2026-10-31')).toMatchObject({ run: null, steps: 1000 });
    }
  });
  it('keeps unavailable averages distinct from recorded zero', () => {
    expect(homeAverages([], '2026-10-02', '2026-10-31')).toMatchObject({ count: 0, steps: null, score: null });
    expect(homeAverages([day('2026-10-31', 0)], '2026-10-02', '2026-10-31').steps).toBe(0);
  });
});
