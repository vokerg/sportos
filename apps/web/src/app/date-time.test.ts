import { describe, expect, it } from 'vitest';
import { formatDate, formatDateText, formatDateTime } from './date-time';

describe('date-time display helpers', () => {
  it('formats calendar dates without changing their calendar day', () => {
    const value = formatDate('2026-09-08');

    expect(value).toContain('2026');
    expect(value).not.toBe('2026-09-08');
  });

  it('formats timestamps for local display without ISO transport details', () => {
    const value = formatDateTime('2026-09-08T21:02:38.389Z');

    expect(value).toContain('2026');
    expect(value).not.toContain('T');
    expect(value).not.toContain('.389Z');
  });

  it('uses fallbacks for missing values and preserves malformed values for diagnosis', () => {
    expect(formatDate(null, 'No date')).toBe('No date');
    expect(formatDateTime(undefined, 'No timestamp')).toBe('No timestamp');
    expect(formatDateTime('not-a-timestamp')).toBe('not-a-timestamp');
  });

  it('formats ISO values embedded in explanatory text', () => {
    const value = formatDateText('Saved 2026-09-08T21:02:38.389Z for 2026-09-08.');

    expect(value).toContain('Saved');
    expect(value).not.toContain('2026-09-08T21:02:38.389Z');
    expect(value).not.toContain(' for 2026-09-08.');
  });
});
