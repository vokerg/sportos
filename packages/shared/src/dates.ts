const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

export function excelSerialDateToIsoDate(serial: number): string {
  if (!Number.isFinite(serial)) throw new Error(`Invalid Excel serial date: ${serial}`);
  const ms = EXCEL_EPOCH_UTC + Math.round(serial) * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function excelTimeFractionToSeconds(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid Excel time fraction: ${value}`);
  return Math.round(value * 24 * 60 * 60);
}

export function isoDateToPgDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Expected yyyy-mm-dd, got ${iso}`);
  return iso;
}
