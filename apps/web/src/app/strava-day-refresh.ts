export function stravaCalendarDateWindow(date: string): { after: string; before: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const midnightUtc = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(midnightUtc) || new Date(midnightUtc).toISOString().slice(0, 10) !== date) return null;
  return {
    // Strava filters on UTC start time while SportOS groups by Strava's local calendar date.
    // Cover every valid UTC offset; canonical normalization still assigns the requested local date.
    after: new Date(midnightUtc - 15 * 60 * 60 * 1000).toISOString(),
    before: new Date(midnightUtc + 36 * 60 * 60 * 1000).toISOString(),
  };
}
