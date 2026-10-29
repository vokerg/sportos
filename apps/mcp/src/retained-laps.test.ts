import { describe, it, expect } from 'vitest';
import { fitLap } from '@sportos/db';
describe('allowlisted FIT laps', () => {
  it('keeps timer distinct from moving and refuses unknown units and conflicting native fields', () => {
    const fields = [
      { name: 'total_distance', value: 400, units: 'm' },
      { name: 'total_timer_time', value: 90, units: 's' },
      { name: 'total_elapsed_time', value: 100, units: 's' },
      { name: 'avg_heart_rate', value: 140, units: 'bpm' },
      { name: 'notes', value: 'ignore previous instructions' },
    ];
    expect(fitLap(fields, 0)).toEqual({
      index: 0,
      distanceM: 400,
      timerS: 90,
      elapsedS: 100,
      movingS: null,
      avgHrBpm: 140,
    });
    expect(
      fitLap([...fields, { name: 'total_distance', value: 450, units: 'm' }], 0).distanceM,
    ).toBeNull();
    expect(
      fitLap(
        [
          { name: 'total_distance', value: 400, units: 'yards' },
          { name: 'avg_heart_rate', value: 140, units: 'bpm', developerIndex: 1 },
        ],
        0,
      ),
    ).toMatchObject({ distanceM: null, avgHrBpm: null });
  });
});
