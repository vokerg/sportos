import { createHash } from 'node:crypto';
import { rowHash } from '@sportos/shared';
import type { Json } from '@sportos/db';

export const MAX_GARMIN_CSV_ROWS = 50_000;

export type GarminReportType =
  | 'daily_summary'
  | 'steps_weekly'
  | 'calories_weekly'
  | 'floors_weekly'
  | 'weight_body_composition';

export interface GarminCsvRawRow {
  rowIndex: number;
  cells: string[];
  contextDate: string | null;
  rowHash: string;
}

export interface GarminCsvObservation {
  reportType: GarminReportType;
  identityKey: string;
  recordedDate: string;
  recordedTime: string | null;
  values: Json;
  valueHash: string;
  sourceRowIndex: number;
}

export interface GarminCsvWarning {
  code: 'GARMIN_ROW_SKIPPED';
  message: string;
  rowIndex: number;
}

export interface GarminCsvExtract {
  filename: string;
  sha256: string;
  reportType: GarminReportType;
  rows: GarminCsvRawRow[];
  observations: GarminCsvObservation[];
  warnings: GarminCsvWarning[];
}

export class GarminCsvError extends Error {
  constructor(
    readonly code: 'INVALID_GARMIN_CSV' | 'UNSUPPORTED_GARMIN_REPORT' | 'GARMIN_CSV_TOO_MANY_ROWS',
    message: string,
  ) {
    super(message);
    this.name = 'GarminCsvError';
  }
}

export function readGarminCsvBuffer(bytes: Uint8Array, filename: string): GarminCsvExtract {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new GarminCsvError('INVALID_GARMIN_CSV', 'The Garmin CSV is not valid UTF-8 text.');
  }
  if (text.startsWith('\uFEFF')) text = text.slice(1);
  if (text.includes('\u0000')) throw new GarminCsvError('INVALID_GARMIN_CSV', 'The Garmin CSV contains invalid null bytes.');

  const matrix = parseCsv(text);
  if (matrix.length === 0) throw new GarminCsvError('INVALID_GARMIN_CSV', 'The Garmin CSV does not contain any rows.');
  if (matrix.length > MAX_GARMIN_CSV_ROWS) {
    throw new GarminCsvError('GARMIN_CSV_TOO_MANY_ROWS', `The Garmin CSV exceeds ${MAX_GARMIN_CSV_ROWS} rows.`);
  }

  const header = trimTrailingEmpty(matrix[0] ?? []).map(normalizeHeader);
  const reportType = detectReportType(header);
  const rows: GarminCsvRawRow[] = [];
  const observations: GarminCsvObservation[] = [];
  const warnings: GarminCsvWarning[] = [];
  let contextDate: string | null = null;

  for (let index = 0; index < matrix.length; index += 1) {
    const rowIndex = index + 1;
    const cells = trimTrailingEmpty(matrix[index] ?? []).map((cell) => boundedCell(cell));
    if (cells.every((cell) => cell.trim() === '')) continue;

    if (reportType === 'weight_body_composition' && rowIndex > 1) {
      const dateMarker = cells.length === 1 ? parseEnglishDate(cells[0] ?? '') : null;
      if (dateMarker) contextDate = dateMarker;
    }

    const raw = {
      rowIndex,
      cells,
      contextDate,
      rowHash: rowHash({ reportType, cells, contextDate }),
    } satisfies GarminCsvRawRow;
    rows.push(raw);
    if (rowIndex === 1) continue;

    const parsed = parseObservation(reportType, cells, contextDate, rowIndex);
    if ('warning' in parsed) {
      if (parsed.warning) warnings.push(parsed.warning);
      continue;
    }
    observations.push(parsed.observation);
  }

  return {
    filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    reportType,
    rows,
    observations,
    warnings,
  };
}

function parseObservation(
  reportType: GarminReportType,
  cells: string[],
  contextDate: string | null,
  rowIndex: number,
): { observation: GarminCsvObservation } | { warning: GarminCsvWarning | null } {
  if (reportType === 'daily_summary') {
    const recordedDate = parseIsoDate(cells[0] ?? '');
    const steps = parseNonNegativeInteger(cells[1]);
    const distanceKm = parseNonNegativeNumber(cells[2]);
    const totalCalories = parseNonNegativeInteger(cells[3]);
    if (!recordedDate || steps === null || distanceKm === null || totalCalories === null) {
      return skipped(rowIndex, 'Daily Garmin summary requires an ISO date, steps, distance_km, and total_calories.');
    }
    return observation(reportType, recordedDate, recordedDate, null, { steps, distanceKm, totalCalories }, rowIndex);
  }

  if (reportType === 'weight_body_composition') {
    if (cells.length === 1 && parseEnglishDate(cells[0] ?? '')) return { warning: null };
    const time = parseTime(cells[0] ?? '');
    const weightKg = parseUnitNumber(cells[1], 'kg');
    if (!contextDate || !time || weightKg === null) {
      return skipped(rowIndex, 'Weight row requires a preceding date, a 24-hour time, and a weight in kg.');
    }
    if (
      !isOptionalUnitNumber(cells[2], 'kg')
      || !isOptionalNumber(cells[3])
      || !isOptionalUnitNumber(cells[4], '%')
      || !isOptionalUnitNumber(cells[5], 'kg')
      || !isOptionalUnitNumber(cells[6], 'kg')
      || !isOptionalUnitNumber(cells[7], '%')
    ) {
      return skipped(rowIndex, 'Weight row contains an invalid optional body-composition value.');
    }
    const values: Json = {
      weightKg,
      changeKg: parseOptionalUnitNumber(cells[2], 'kg'),
      bmi: parseOptionalNumber(cells[3]),
      bodyFatPercent: parseOptionalUnitNumber(cells[4], '%'),
      skeletalMuscleMassKg: parseOptionalUnitNumber(cells[5], 'kg'),
      boneMassKg: parseOptionalUnitNumber(cells[6], 'kg'),
      bodyWaterPercent: parseOptionalUnitNumber(cells[7], '%'),
    };
    const measurementFingerprint = rowHash({ reportType, recordedDate: contextDate, recordedTime: time, values });
    return observation(
      reportType,
      `${contextDate}T${time}:${measurementFingerprint}`,
      contextDate,
      time,
      values,
      rowIndex,
    );
  }

  if (reportType === 'steps_weekly') {
    const recordedDate = parseSlashDate(cells[0] ?? '');
    const steps = parseNonNegativeInteger(cells[1]);
    if (!recordedDate || steps === null) return skipped(rowIndex, 'Weekly steps row requires a valid DD/MM/YYYY date and non-negative integer value.');
    return observation(reportType, recordedDate, recordedDate, null, { steps }, rowIndex);
  }

  const periodLabel = boundedLabel(cells[0]);
  const recordedDate = parseIsoDate(cells[1] ?? '');
  if (!periodLabel || !recordedDate) return skipped(rowIndex, 'Weekly Garmin row requires a period label and valid week_end date.');

  if (reportType === 'calories_weekly') {
    const activeCalories = parseNonNegativeInteger(cells[2]);
    const restingCalories = parseNonNegativeInteger(cells[3]);
    const averageDailyTotal = parseNonNegativeInteger(cells[4]);
    if (activeCalories === null || restingCalories === null || averageDailyTotal === null) {
      return skipped(rowIndex, 'Weekly calories row requires non-negative integer calorie values.');
    }
    return observation(reportType, recordedDate, recordedDate, null, {
      periodLabel,
      activeCalories,
      restingCalories,
      averageDailyTotal,
    }, rowIndex);
  }

  const climbedFloors = parseNonNegativeInteger(cells[2]);
  const descendedFloors = parseNonNegativeInteger(cells[3]);
  if (climbedFloors === null || descendedFloors === null) {
    return skipped(rowIndex, 'Weekly floors row requires non-negative integer climbed and descended values.');
  }
  return observation(reportType, recordedDate, recordedDate, null, {
    periodLabel,
    climbedFloors,
    descendedFloors,
  }, rowIndex);
}

function observation(
  reportType: GarminReportType,
  identityKey: string,
  recordedDate: string,
  recordedTime: string | null,
  values: Json,
  sourceRowIndex: number,
): { observation: GarminCsvObservation } {
  return {
    observation: {
      reportType,
      identityKey,
      recordedDate,
      recordedTime,
      values,
      valueHash: rowHash({ reportType, identityKey, values }),
      sourceRowIndex,
    },
  };
}

function skipped(rowIndex: number, message: string): { warning: GarminCsvWarning } {
  return { warning: { code: 'GARMIN_ROW_SKIPPED', message, rowIndex } };
}

function detectReportType(header: string[]): GarminReportType {
  const key = header.join('|');
  if (key === 'date|steps|distance_km|total_calories') return 'daily_summary';
  if (key === '|actual') return 'steps_weekly';
  if (key === 'period_label|week_end|active_calories|resting_calories|avg_daily_total') return 'calories_weekly';
  if (key === 'period_label|week_end|climbed_floors|descended_floors') return 'floors_weekly';
  if (key === 'time|weight|change|bmi|body fat|skeletal muscle mass|bone mass|body water') {
    return 'weight_body_composition';
  }
  throw new GarminCsvError('UNSUPPORTED_GARMIN_REPORT', 'The CSV header does not match a supported Garmin report.');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  if (quoted) throw new GarminCsvError('INVALID_GARMIN_CSV', 'The Garmin CSV contains an unterminated quoted value.');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function trimTrailingEmpty(values: string[]): string[] {
  const result = [...values];
  while (result.length > 0 && result.at(-1)?.trim() === '') result.pop();
  return result;
}

function boundedCell(value: string): string {
  if (value.length > 2_000) throw new GarminCsvError('INVALID_GARMIN_CSV', 'The Garmin CSV contains a cell longer than 2,000 characters.');
  return value;
}

function boundedLabel(value: string | undefined): string | null {
  const label = value?.trim().replace(/\s+/g, ' ').slice(0, 100) ?? '';
  return label || null;
}

function parseSlashDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? validDate(`${match[3]}-${match[2]}-${match[1]}`) : null;
}

function parseIsoDate(value: string): string | null {
  return validDate(value.trim());
}

function parseEnglishDate(value: string): string | null {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const month = months[match[2]!.toLowerCase()];
  return month ? validDate(`${match[3]}-${month}-${match[1]!.padStart(2, '0')}`) : null;
}

function validDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function parseTime(value: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? `${match[1]}:${match[2]}:00` : null;
}

function parseNonNegativeInteger(value: string | undefined): number | null {
  const text = value?.trim() ?? '';
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeNumber(value: string | undefined): number | null {
  const text = value?.trim() ?? '';
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseOptionalNumber(value: string | undefined): number | null {
  const text = value?.trim() ?? '';
  if (text === '' || text === '--') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function isOptionalNumber(value: string | undefined): boolean {
  const text = value?.trim() ?? '';
  return text === '' || text === '--' || parseOptionalNumber(text) !== null;
}

function parseUnitNumber(value: string | undefined, unit: 'kg' | '%'): number | null {
  const text = value?.trim() ?? '';
  const suffix = unit === '%' ? '%' : 'kg';
  const match = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*${suffix === '%' ? '%' : 'kg'}$`, 'i').exec(text);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalUnitNumber(value: string | undefined, unit: 'kg' | '%'): number | null {
  const text = value?.trim() ?? '';
  return text === '' || text === '--' ? null : parseUnitNumber(text, unit);
}

function isOptionalUnitNumber(value: string | undefined, unit: 'kg' | '%'): boolean {
  const text = value?.trim() ?? '';
  return text === '' || text === '--' || parseUnitNumber(text, unit) !== null;
}
