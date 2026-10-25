import { describe, expect, it } from 'vitest';
import { garminDayCheckedAfterEnd, garminLocalDate } from './garmin-day-completeness.js';

const row = (checkedAt: Date, extra = {}) => ({ state: 'available', retrieved_at: checkedAt,
  attempted_at: checkedAt, attempt_json: {}, ...extra }) as Parameters<typeof garminDayCheckedAfterEnd>[1];

describe('Garmin day calendar completeness', () => {
  const beforeMidnight = new Date(2026, 9, 25, 23, 59);
  const afterMidnight = new Date(2026, 9, 26, 0, 1);
  it('uses local calendar dates over the DST transition without a fixed 24-hour cutoff', () => {
    expect(garminLocalDate(beforeMidnight)).toBe('2026-10-25');
    expect(garminDayCheckedAfterEnd('2026-10-25', row(beforeMidnight), afterMidnight)).toBe(false);
    expect(garminDayCheckedAfterEnd('2026-10-25', row(afterMidnight), afterMidnight)).toBe(true);
  });
  it('lets a later successful check finalize identical retained content', () => {
    expect(garminDayCheckedAfterEnd('2026-10-25', row(beforeMidnight, {
      attempt_json: { checkedAt: afterMidnight.toISOString() },
    }), afterMidnight)).toBe(true);
  });
  it('never uses a later failed attempt to finalize provisional evidence', () => {
    expect(garminDayCheckedAfterEnd('2026-10-25', row(beforeMidnight, {
      state: 'failed', attempted_at: afterMidnight,
    }), afterMidnight)).toBe(false);
  });
  it('supports legacy successful unsupported checks without a source version', () => {
    expect(garminDayCheckedAfterEnd('2026-10-25', row(afterMidnight, {
      state: 'unsupported', retrieved_at: null,
    }), afterMidnight)).toBe(true);
    expect(garminDayCheckedAfterEnd('2026-10-25', row(afterMidnight, {
      state: 'failed', retrieved_at: null,
    }), afterMidnight)).toBe(false);
  });
  it.each(['invalid', '2099-01-01T00:00:00Z'])('rejects an invalid or future success timestamp: %s', checkedAt => {
    expect(garminDayCheckedAfterEnd('2026-10-25', row(beforeMidnight, {
      attempt_json: { checkedAt },
    }), afterMidnight)).toBe(false);
  });
});
