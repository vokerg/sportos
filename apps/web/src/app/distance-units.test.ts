import { describe, expect, it } from 'vitest';
import { kilometersToMeters, metersToKilometers } from './distance-units';

describe('distance unit conversions', () => {
  it('removes floating-point tails from kilometer values', () => {
    expect(metersToKilometers(11_806.7)).toBe(11.8067);
    expect(metersToKilometers(11_737.4)).toBe(11.7374);
    expect(kilometersToMeters(12.85043434)).toBe(12_850.434);
  });
});
