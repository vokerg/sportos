import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, formatDuration, formatPace, isCalendarDate, shiftCalendarDate, localToday }
  from '../src/ui/format.mjs';

test('distance, elapsed time and pace keep meaningful units and missing-value treatment', () => {
  assert.equal(formatDistance(25), '25 m');
  assert.equal(formatDistance(1024), '1.02 km');
  assert.equal(formatDistance(-1), '—');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatPace(242), '4:02 /km');
  assert.equal(formatPace(0), '—');
});
test('calendar dates preserve local days across month and leap boundaries', () => {
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2025-02-29'), false);
  assert.equal(shiftCalendarDate('2024-02-29', 1), '2024-03-01');
  assert.equal(shiftCalendarDate('2026-01-01', -1), '2025-12-31');
  assert.equal(localToday(new Date(2026, 9, 27, 23, 0)), '2026-10-27');
});
