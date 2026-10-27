/** Framework-agnostic presentation units. These are not scoring or canonical transforms. */
export function formatDistance(metres) {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds), hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60), secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}
export function formatPace(secondsPerKm) {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return '—';
  return `${formatDuration(secondsPerKm)} /km`;
}
/** Parse date-only strings in local-calendar space (never UTC midnight). */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}
export function shiftCalendarDate(date, days) {
  if (!isCalendarDate(date) || !Number.isInteger(days)) throw new Error('Invalid calendar date');
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(y, m - 1, d + days, 12);
  return [shifted.getFullYear(), String(shifted.getMonth() + 1).padStart(2, '0'),
    String(shifted.getDate()).padStart(2, '0')].join('-');
}
export function localToday(now = new Date()) {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
}
