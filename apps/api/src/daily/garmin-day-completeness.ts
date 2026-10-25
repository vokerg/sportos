import type { GarminDayRepository } from '@sportos/db';

type DayRow = Awaited<ReturnType<GarminDayRepository['read']>>[number];

/** The optional workstation helper and API use the same local calendar. Date-only
 * values are never interpreted as UTC instants. */
export function garminLocalDate(instant = new Date()): string {
  return `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
}

export function garminDayCheckedAfterEnd(date: string, row: DayRow, now = new Date()): boolean {
  const attempt = row.attempt_json;
  const checkedAt = attempt && typeof attempt === 'object' && !Array.isArray(attempt) && typeof attempt.checkedAt === 'string'
    ? new Date(attempt.checkedAt) : row.retrieved_at ?? (!['failed', 'authentication_required', 'rate_limited'].includes(row.state) ? row.attempted_at : null);
  // Legacy heads fall back to the retained version, never a failed attempt.
  // Future timestamps cannot establish completeness.
  return Boolean(checkedAt && checkedAt <= now && garminLocalDate(checkedAt) > date);
}
