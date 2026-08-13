import { describe, expect, it } from 'vitest';
import { integerOrNull } from './provider-sync-runner.js';

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
});
