import { buildPerformanceEvent, inferDistanceFromSheetName } from '@sportos/domain';
import { excelSerialDateToIsoDate, excelTimeFractionToSeconds } from '@sportos/shared';
import type { PerformanceEventInput } from '@sportos/shared';
import { asNumber, asString, sheetMatrix, type WorkbookExtract } from './xlsx-reader.js';

// Conservative sheet-to-distance mapping based on the uploaded workbook discovery.
// Null means: keep the raw row in source_records but do not normalize until the mapping is confirmed.
export const RUN_DB_SHEET_DISTANCE_M: Record<string, number | null> = {
  '5k(sorted': 5000,
  '10k(sorted)': 10000,
  '12': 12000,
  'Лист14': 21100,
  'M': 42195,
  'Лист11': 5000,
  'Лист13': 10000,
  'Лист12': null,
};

export interface RunDbImportResult {
  events: PerformanceEventInput[];
  warnings: string[];
}

export function parseRunDbWorkbook(extract: WorkbookExtract): RunDbImportResult {
  const events: PerformanceEventInput[] = [];
  const warnings: string[] = [];

  for (const sheetName of extract.sheetNames) {
    const mappedDistance = RUN_DB_SHEET_DISTANCE_M[sheetName] ?? inferDistanceFromSheetName(sheetName);
    if (!mappedDistance) {
      warnings.push(`Skipped performance sheet '${sheetName}' because distance mapping is not confirmed.`);
      continue;
    }

    const matrix = sheetMatrix(extract.workbook, sheetName);
    for (let i = 0; i < matrix.length; i += 1) {
      const cells = matrix[i] ?? [];
      if (cells.every(isBlankCell) || isHeaderRow(cells, i)) continue;

      const timeFraction = asNumber(cells[0]);
      const dateSerial = asNumber(cells[1]);
      if (timeFraction === undefined || timeFraction <= 0 || dateSerial === undefined || dateSerial <= 0) {
        warnings.push(`Skipped performance row '${sheetName}'!${i + 1} because time or date is missing or invalid.`);
        continue;
      }

      const durationS = excelTimeFractionToSeconds(timeFraction);
      const eventDate = excelSerialDateToIsoDate(dateSerial);
      const markers = cells.slice(2, 10).map(asString).filter(Boolean).map(String);
      const isTreadmill = markers.some((m) => m.toLowerCase() === 't');
      const isPrMarker = markers.some((m) => m === '*');
      const sourceRank = inferSourceRank(cells.slice(2, 10));
      const tags = [sheetName, ...markers.filter((m) => !['*', 't'].includes(m.toLowerCase()))];
      if (isTreadmill) tags.push('treadmill');
      if (isPrMarker) tags.push('starred');

      const event = buildPerformanceEvent({
        eventDate,
        distanceM: mappedDistance,
        durationS,
        isTreadmill,
        isRace: false,
        isPrMarker,
        sourceRank,
        tags,
        rawPayloadJson: { sheetName, rowIndex: i + 1, cells },
      });

      events.push({
        source: 'run_db_xlsx',
        eventDate: event.eventDate,
        distanceM: event.distanceM,
        durationS: event.durationS,
        paceSPerKm: event.paceSPerKm,
        isTreadmill: event.isTreadmill ?? false,
        isRace: event.isRace ?? false,
        isPrMarker: event.isPrMarker ?? false,
        sourceRank: event.sourceRank,
        tags: event.tags ?? [],
        notes: event.notes,
        rawPayloadJson: event.rawPayloadJson ?? {},
      });
    }
  }

  return { events, warnings };
}

function inferSourceRank(values: unknown[]): number | undefined {
  const candidates = values
    .map(asNumber)
    .filter((value): value is number => value !== undefined && Number.isInteger(value) && value > 0 && value < 1000);
  return candidates.length === 0 ? undefined : candidates[candidates.length - 1];
}

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function isHeaderRow(cells: unknown[], rowIndex: number): boolean {
  if (rowIndex !== 0) return false;
  const first = asString(cells[0])?.toLowerCase();
  const second = asString(cells[1])?.toLowerCase();
  return first?.includes('time') === true || second?.includes('date') === true;
}
