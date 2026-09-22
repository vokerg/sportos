import { describe, expect, it } from 'vitest';
import { integerOrNull, providerActivitySubtype } from './provider-sync-runner.js';
import type { ProviderActivity } from '@sportos/importers';

const baseActivity: ProviderActivity = {
  providerActivityId: '1', providerUpdatedAt: null, name: null, type: 'Run', sportType: 'TrackRun',
  startDate: new Date('2026-09-20T10:00:00Z'), localDate: '2026-09-20', timezone: null,
  distanceM: 5000, elapsedTimeS: 1500, movingTimeS: 1500, elevationGainM: null, averageHeartrate: null,
  maxHeartrate: null, averageSpeedMps: null, calories: null, isManual: false, isIndoor: false,
  isPrivate: false, isRace: false, isTrack: true, raw: {},
};

describe('provider sync integer metrics', () => {
  it('rounds fractional provider values before inserting into integer columns', () => {
    expect(integerOrNull(170.9)).toBe(171);
    expect(integerOrNull(145.4)).toBe(145);
  });

  it('preserves nulls and rejects invalid values', () => {
    expect(integerOrNull(null)).toBeNull();
    expect(integerOrNull(Number.NaN)).toBeNull();
    expect(integerOrNull(-1)).toBeNull();
  });

  it('keeps track runs distinct from outdoor and treadmill runs', () => {
    expect(providerActivitySubtype(baseActivity)).toBe('track');
    expect(providerActivitySubtype({ ...baseActivity, isTrack: false, isIndoor: true })).toBe('treadmill');
    expect(providerActivitySubtype({ ...baseActivity, isTrack: false })).toBe('outdoor');
  });
});
