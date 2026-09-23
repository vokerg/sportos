export const QUICK_RANGE_VALUES = ['custom', '1m', '3m', '6m', 'ytd', '1y', '3y', 'all'] as const;
export type QuickRange = typeof QUICK_RANGE_VALUES[number];

export interface AnalyticsDateRange {
  from: string;
  to: string;
}

export interface QueryParamReader {
  get(name: string): string | null;
}

const MATCHABLE_QUICK_RANGES = ['1m', '3m', '6m', 'ytd', '1y', '3y'] as const;

export function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function localCalendarDate(
  now: Pick<Date, 'getFullYear' | 'getMonth' | 'getDate'> = new Date(),
): string {
  return formatCalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function quickRangeDates(
  range: Exclude<QuickRange, 'custom'>,
  today: Date | string = new Date(),
): AnalyticsDateRange {
  const to = anchorCalendarDate(today);
  if (range === 'all') return { from: '', to: '' };
  if (range === 'ytd') return { from: `${to.slice(0, 4)}-01-01`, to };

  const months = range === '1m' ? 1 : range === '3m' ? 3 : range === '6m' ? 6 : range === '1y' ? 12 : 36;
  return { from: shiftCalendarMonths(to, months), to };
}

export function boundedAllTimeRange(
  to = localCalendarDate(),
  maxDays = 3_660,
): AnalyticsDateRange {
  if (!isCalendarDate(to)) throw new RangeError(`Invalid calendar date: ${to}`);
  if (!Number.isInteger(maxDays) || maxDays < 1) throw new RangeError('maxDays must be a positive integer.');
  return { from: shiftCalendarDays(to, -(maxDays - 1)), to };
}

export function matchingQuickRange(
  from: string,
  to: string,
  maxAllTimeDays = 3_660,
): QuickRange {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return 'custom';

  const all = boundedAllTimeRange(to, maxAllTimeDays);
  if (all.from === from && all.to === to) return 'all';

  for (const range of MATCHABLE_QUICK_RANGES) {
    const dates = quickRangeDates(range, to);
    if (dates.from === from && dates.to === to) return range;
  }
  return 'custom';
}

export function readAnalyticsDateRange(
  query: QueryParamReader,
  fallback: AnalyticsDateRange,
): AnalyticsDateRange & { quickRange: QuickRange } {
  const from = isCalendarDate(query.get('from')) ? query.get('from')! : fallback.from;
  const to = isCalendarDate(query.get('to')) ? query.get('to')! : fallback.to;
  return { from, to, quickRange: matchingQuickRange(from, to) };
}

export function readQueryEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value && allowed.includes(value as T) ? value as T : fallback;
}

export function readQueryCsv<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: readonly T[],
  maxItems = Number.POSITIVE_INFINITY,
): T[] {
  if (!value) return [...fallback];
  const values = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (
    !values.length ||
    values.length > maxItems ||
    new Set(values).size !== values.length ||
    !values.every((item) => allowed.includes(item as T))
  ) return [...fallback];

  return values as T[];
}

export function readQueryNumberCsv<T extends number>(
  value: string | null,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!value) return [...fallback];
  const values = value.split(',').map((item) => Number(item.trim()));
  if (
    !values.length ||
    new Set(values).size !== values.length ||
    !values.every((item) => Number.isFinite(item) && allowed.includes(item as T))
  ) return [...fallback];

  return values as T[];
}

export function isDateRangeOrdered(from: string, to: string): boolean {
  return isCalendarDate(from) && isCalendarDate(to) && from <= to;
}

function anchorCalendarDate(value: Date | string): string {
  if (typeof value === 'string') {
    if (!isCalendarDate(value)) throw new RangeError(`Invalid calendar date: ${value}`);
    return value;
  }
  return localCalendarDate(value);
}

function shiftCalendarMonths(value: string, months: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const targetMonthIndex = month - 1 - months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  return formatCalendarDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

function shiftCalendarDays(value: string, days: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function formatCalendarDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}
