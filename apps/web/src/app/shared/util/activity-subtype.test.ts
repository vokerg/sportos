import { describe, expect, it } from 'vitest';
import { activitySubtypeLabel } from './activity-subtype';
describe('run labels', () => {
  it('omits default outdoor only for runs, and displays explicit Garmin types', () => {
    expect(activitySubtypeLabel('run', 'outdoor')).toBe('');
    expect(activitySubtypeLabel('run', 'outdoor', { subtype: 'track' })).toBe('Track');
    expect(activitySubtypeLabel('run', 'outdoor', { subtype: 'treadmill' })).toBe('Treadmill');
    expect(activitySubtypeLabel('run', 'unknown')).toBe('');
    expect(activitySubtypeLabel('swim', 'outdoor')).toBe('outdoor');
    expect(activitySubtypeLabel('run', 'race')).toBe('race');
  });
});
