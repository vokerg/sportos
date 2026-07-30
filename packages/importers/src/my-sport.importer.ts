import type { SpreadsheetScoreComponentEvidence } from '@sportos/domain';
import { excelSerialDateToIsoDate } from '@sportos/shared';
import type { CanonicalActivityInput, DailyMetricInput } from '@sportos/shared';
import { asNumber, normalizeHeader, rowObjectFromHeaders, sheetMatrix, type WorkbookExtract } from './xlsx-reader.js';

const MY_SPORT_KNOWN_HEADERS = new Set([
  'date',
  'steps',
  'r_in',
  'r_out',
  'bike_in',
  'sup',
  'hiit',
  'raw',
  'bike_out',
  'wototal',
  'swim',
  'pow',
  'bike',
  'run',
  'run_to_s',
  'bike_to_s',
  'sup_to_s',
  'raw_to_s',
  'swim_to_s',
  'all',
  'a10',
  'a20d',
  '30all',
  'a60d',
  'a365',
]);

const MY_SPORT_AUXILIARY_SHEETS = new Set(['Sheet2', 'Sheet8']);

export interface SpreadsheetScoreEvidence {
  metricDate: string;
  excelAllPoints?: number;
  components: SpreadsheetScoreComponentEvidence[];
  sheetName: string;
  rowIndex: number;
}

export interface MySportImportResult {
  dailyMetrics: DailyMetricInput[];
  activities: CanonicalActivityInput[];
  scoreEvidence: SpreadsheetScoreEvidence[];
  warnings: string[];
}

export function parseMySportWorkbook(extract: WorkbookExtract, sheetName = 'Sheet1'): MySportImportResult {
  const dailyMetrics: DailyMetricInput[] = [];
  const activities: CanonicalActivityInput[] = [];
  const scoreEvidence: SpreadsheetScoreEvidence[] = [];
  const warnings: string[] = [];

  if (!extract.sheetNames.includes(sheetName)) {
    warnings.push(`Daily-ledger sheet '${sheetName}' was not found.`);
    return { dailyMetrics, activities, scoreEvidence, warnings };
  }

  for (const otherSheetName of extract.sheetNames) {
    if (otherSheetName === sheetName || MY_SPORT_AUXILIARY_SHEETS.has(otherSheetName)) continue;
    warnings.push(`Ignored unknown daily-ledger sheet '${otherSheetName}'.`);
  }

  const matrix = sheetMatrix(extract.workbook, sheetName);
  const headers = matrix[0] ?? [];
  const warnedHeaders = new Set<string>();

  headers.forEach((header) => {
    const normalized = normalizeHeader(header);
    if (!normalized || MY_SPORT_KNOWN_HEADERS.has(normalized) || warnedHeaders.has(normalized)) return;
    warnedHeaders.add(normalized);
    warnings.push(`Ignored unknown daily-ledger column '${String(header).trim()}' (normalized as '${normalized}').`);
  });

  for (let i = 1; i < matrix.length; i += 1) {
    const cells = matrix[i] ?? [];
    if (cells.every(isBlankCell)) continue;

    const row = rowObjectFromHeaders(headers, cells);
    const dateSerial = asNumber(row.date);
    if (dateSerial === undefined || dateSerial <= 0) {
      warnings.push(`Skipped ${sheetName} row ${i + 1} because Date is missing or invalid.`);
      continue;
    }

    const activityDate = excelSerialDateToIsoDate(dateSerial);
    const steps = Math.round(asNumber(row.steps) ?? 0);
    const runInKm = asNumber(row.r_in) ?? 0;
    const runOutKm = asNumber(row.r_out) ?? 0;
    const bikeInKm = asNumber(row.bike_in) ?? 0;
    const bikeOutKm = asNumber(row.bike_out) ?? 0;
    const supKm = asNumber(row.sup) ?? 0;
    const rowingValue = asNumber(row.raw) ?? 0;
    const hiitValue = asNumber(row.hiit) ?? 0;
    const swimMeters = asNumber(row.swim) ?? 0;
    const workoutPoints = Math.round(asNumber(row.wototal) ?? 0);
    const powerPoints = Math.round(asNumber(row.pow) ?? 0);
    const aggregateBikeKm = asNumber(row.bike) ?? bikeInKm + bikeOutKm;
    const aggregateRunKm = asNumber(row.run) ?? runInKm + runOutKm;
    const excelAllPoints = asNumber(row.all);

    const basePayload = { sheetName, rowIndex: i + 1, row };

    dailyMetrics.push({
      metricDate: activityDate,
      steps,
      runM: aggregateRunKm * 1000,
      bikeM: aggregateBikeKm * 1000,
      swimM: swimMeters,
      workoutPoints,
      powerPoints,
      excelAllPoints,
      excelRowHash: extract.rows.find((record) => record.sheetName === sheetName && record.rowIndex === i + 1)?.hash,
    });

    scoreEvidence.push({
      metricDate: activityDate,
      excelAllPoints,
      components: scoreComponents(row),
      sheetName,
      rowIndex: i + 1,
    });

    if (steps > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'steps', subtype: 'manual', steps, rawPayloadJson: basePayload });
    if (runInKm > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'run', subtype: 'treadmill', distanceM: runInKm * 1000, rawPayloadJson: basePayload });
    if (runOutKm > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'run', subtype: 'outdoor', distanceM: runOutKm * 1000, rawPayloadJson: basePayload });
    if (bikeInKm > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'bike', subtype: 'indoor', distanceM: bikeInKm * 1000, rawPayloadJson: basePayload });
    if (bikeOutKm > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'bike', subtype: 'outdoor', distanceM: bikeOutKm * 1000, rawPayloadJson: basePayload });
    if (supKm > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'sup', subtype: 'outdoor', distanceM: supKm * 1000, rawPayloadJson: basePayload });
    if (rowingValue > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'rowing', subtype: 'indoor', effortPoints: Math.round(rowingValue), rawPayloadJson: basePayload });
    if (hiitValue > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'hiit', subtype: 'manual', effortPoints: Math.round(hiitValue), rawPayloadJson: basePayload });
    if (swimMeters > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'swim', subtype: 'manual', distanceM: swimMeters, rawPayloadJson: basePayload });
    if (workoutPoints > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'workout', subtype: 'manual', effortPoints: workoutPoints, rawPayloadJson: basePayload });
    if (powerPoints > 0) activities.push({ source: 'my_sport_xlsx', activityDate, activityType: 'power_bonus', subtype: 'manual', effortPoints: powerPoints, rawPayloadJson: basePayload });
  }

  if (dailyMetrics.length === 0) {
    warnings.push(`No daily metrics found in ${sheetName}. Check whether the workbook structure changed.`);
  }

  return { dailyMetrics, activities, scoreEvidence, warnings };
}

function scoreComponents(row: Record<string, unknown>): SpreadsheetScoreComponentEvidence[] {
  const candidates: Array<SpreadsheetScoreComponentEvidence | null> = [
    scoreComponent('run', 'run_to_s', row.run_to_s),
    scoreComponent('bike', 'bike_to_s', row.bike_to_s),
    scoreComponent('sup', 'sup_to_s', row.sup_to_s),
    scoreComponent('rowing', 'raw_to_s', row.raw_to_s),
    scoreComponent('swim', 'swim_to_s', row.swim_to_s),
  ];
  return candidates.filter((component): component is SpreadsheetScoreComponentEvidence => component !== null);
}

function scoreComponent(
  activityType: SpreadsheetScoreComponentEvidence['activityType'],
  sourceColumn: string,
  value: unknown,
): SpreadsheetScoreComponentEvidence | null {
  const importedPoints = asNumber(value);
  return importedPoints === undefined ? null : { activityType, sourceColumn, importedPoints };
}

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}
