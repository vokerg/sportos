import { describe, expect, it } from 'vitest';
import { formatSwimMeters } from './swim-distance';

describe('swim distance display', () => {
  it('shows positive sub-kilometer swims and keeps the stored meter unit', () => {
    expect(formatSwimMeters(400)).toBe('400 m');
    expect(formatSwimMeters(750.5)).toBe('750.5 m');
    expect(formatSwimMeters(1_250)).toBe('1,250 m');
    expect(formatSwimMeters(0)).toBe('0 m');
    expect(formatSwimMeters(null)).toBe('—');
  });
});
