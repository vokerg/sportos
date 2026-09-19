import { describe, expect, it } from 'vitest';
import { formatDurationClock } from './duration';

describe('formatDurationClock', () => {
  it('preserves seconds at minute and hour boundaries', () => {
    expect(formatDurationClock(1165)).toBe('19:25');
    expect(formatDurationClock(3599)).toBe('59:59');
    expect(formatDurationClock(3600)).toBe('1:00:00');
    expect(formatDurationClock(3661)).toBe('1:01:01');
  });
});
