const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function excelSerialDateToIsoDate(serial: number): string {
  if (!Number.isFinite(serial)) throw new Error(`Invalid Excel serial date: ${serial}`);
  const ms = EXCEL_EPOCH_UTC + Math.round(serial) * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function excelTimeFractionToSeconds(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid Excel time fraction: ${value}`);
  return Math.round(value * 24 * 60 * 60);
}

export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isoDateToPgDate(iso: string): string {
  if (!isRealIsoDate(iso)) throw new Error(`Expected a real yyyy-mm-dd calendar date, got ${iso}`);
  return iso;
}

export function inclusiveDateSpanDays(from: string, to: string): number {
  if (!isRealIsoDate(from) || !isRealIsoDate(to) || from > to) {
    throw new Error(`Expected an ordered ISO date range, got ${from} through ${to}`);
  }
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}
