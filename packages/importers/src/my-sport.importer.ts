import { excelSerialDateToIsoDate } from '@sportos/shared';
import type { CanonicalActivityInput, DailyMetricInput } from '@sportos/shared';
import { asNumber, rowObjectFromHeaders, sheetMatrix, type WorkbookExtract } from './xlsx-reader.js';

export interface MySportImportResult {
  dailyMetrics: DailyMetricInput[];
  activities: CanonicalActivityInput[];
  warnings: string[];
}

export function parseMySportWorkbook(extract: WorkbookExtract, sheetName = 'Sheet1'): MySportImportResult {
  const matrix = sheetMatrix(extract.workbook, sheetName);
  const headers = matrix[0] ?? [];
  const dailyMetrics: DailyMetricInput[] = [];
  const activities: CanonicalActivityInput[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < matrix.length; i += 1) {
    const cells = matrix[i] ?? [];
    const row = rowObjectFromHeaders(headers, cells);
    const dateSerial = asNumber(row.date);
    if (!dateSerial) continue;

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
      excelRowHash: extract.rows.find((r) => r.sheetName === sheetName && r.rowIndex === i + 1)?.hash,
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

  return { dailyMetrics, activities, warnings };
}
