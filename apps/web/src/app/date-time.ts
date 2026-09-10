const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_IN_TEXT_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const ISO_DATE_IN_TEXT_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

/**
 * Formats an API calendar date for display without changing the ISO value
 * used by inputs, requests, sorting, or exports.
 */
export function formatDate(value: string | null | undefined, fallback = 'Not available'): string {
  if (value === null || value === undefined || value.trim() === '') return fallback;
  const date = parseDate(value);
  return date === null ? value : DATE_FORMATTER.format(date);
}

/**
 * Formats an API timestamp in the browser's local timezone and locale.
 * Milliseconds and the transport timezone marker are intentionally omitted.
 */
export function formatDateTime(value: string | null | undefined, fallback = 'Not available'): string {
  if (value === null || value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim();
  const date = parseDate(normalized);
  if (date === null) return value;
  return ISO_DATE_PATTERN.test(normalized) ? DATE_FORMATTER.format(date) : DATE_TIME_FORMATTER.format(date);
}

/** Formats ISO dates and timestamps embedded in user-facing text. */
export function formatDateText(value: string): string {
  return value
    .replace(ISO_TIMESTAMP_IN_TEXT_PATTERN, (match) => formatDateTime(match))
    .replace(ISO_DATE_IN_TEXT_PATTERN, (match) => formatDate(match));
}

function parseDate(value: string): Date | null {
  const candidate = ISO_DATE_PATTERN.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(candidate);
  return Number.isNaN(date.valueOf()) ? null : date;
}
