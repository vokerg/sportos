import { BadRequestException } from '@nestjs/common';
import type { GarminDayCategory, Json } from '@sportos/db';
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid Garmin day payload.');
  return value as ObjectValue;
}
function number(value: unknown, maximum = 10_000_000): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) throw new BadRequestException('Invalid Garmin day metric.');
  return value;
}
function metrics(value: ObjectValue, fields: Record<string, string>): Json {
  return Object.fromEntries(Object.entries(fields).map(([name, source]) => [name, number(value[source])])) as Json;
}
function exactDate(value: ObjectValue, date: string) {
  if (value.calendarDate !== undefined && value.calendarDate !== null && value.calendarDate !== date) throw new BadRequestException('Garmin day date does not match the selected date.');
}
export function projectGarminDay(category: GarminDayCategory, raw: Json, date: string): Json {
  if (raw === null || (Array.isArray(raw) && raw.length === 0)) return {};
  if (category === 'body_battery') {
    if (!Array.isArray(raw) || raw.length > 1) throw new BadRequestException('Invalid Body Battery day.');
    if (!raw.length) return {};
    const entry = object(raw[0]); if (entry.date !== date) throw new BadRequestException('Invalid Body Battery date.');
    return metrics(entry, { charged: 'charged', drained: 'drained' });
  }
  const value = object(raw); exactDate(value, date);
  if (category === 'summary') return metrics(value, { steps: 'totalSteps', distanceM: 'totalDistanceMeters', totalCalories: 'totalKilocalories', activeCalories: 'activeKilocalories', restingCalories: 'bmrKilocalories', floorsClimbed: 'floorsAscended', floorsDescended: 'floorsDescended', moderateIntensityMinutes: 'moderateIntensityMinutes', vigorousIntensityMinutes: 'vigorousIntensityMinutes' });
  if (category === 'weight') {
    if (!Array.isArray(value.dateWeightList) || value.dateWeightList.length > 100) throw new BadRequestException('Invalid Garmin measurement list.');
    return { measurements: value.dateWeightList.map(item => {
      const row = object(item); exactDate(row, date);
      const epoch = number(row.timestampGMT, 8_640_000_000_000_000);
      // Garmin day-view masses are grams; percentages/BMI remain unscaled.
      const grams = (key: string) => { const mass = number(row[key], 1_000_000); return mass === null ? null : mass / 1000; };
      return { recordedAt: epoch === null ? null : new Date(epoch).toISOString(), weightKg: grams('weight'), bmi: number(row.bmi, 200), bodyFatPct: number(row.bodyFat, 100), muscleMassKg: grams('muscleMass'), boneMassKg: grams('boneMass'), bodyWaterPct: number(row.bodyWater, 100) };
    }) };
  }
  if (category === 'sleep') {
    const dto = value.dailySleepDTO === undefined || value.dailySleepDTO === null ? {} : object(value.dailySleepDTO); exactDate(dto, date);
    return metrics(dto, { sleepSeconds: 'sleepTimeSeconds', deepSleepSeconds: 'deepSleepSeconds', lightSleepSeconds: 'lightSleepSeconds', remSleepSeconds: 'remSleepSeconds', awakeSeconds: 'awakeSleepSeconds', napSeconds: 'napTimeSeconds' });
  }
  if (category === 'heart_rate') return metrics(value, { restingBpm: 'restingHeartRate', minBpm: 'minHeartRate', maxBpm: 'maxHeartRate' });
  if (category === 'hrv') {
    const summary = value.hrvSummary === undefined || value.hrvSummary === null ? {} : object(value.hrvSummary); exactDate(summary, date);
    return metrics(summary, { lastNightAvgMs: 'lastNightAvg', lastNightHighMs: 'lastNight5MinHigh', weeklyAvgMs: 'weeklyAvg' });
  }
  if (category === 'stress') return metrics(value, { averageLevel: 'avgStressLevel', maxLevel: 'maxStressLevel' });
  if (!Array.isArray(value.items) || value.items.length > 20 || typeof value.complete !== 'boolean') throw new BadRequestException('Invalid Garmin activity day.');
  const identities = value.items.map(item => {
    const row = object(item);
    if ((typeof row.activityId === 'number' && !Number.isSafeInteger(row.activityId)) || !['number','string'].includes(typeof row.activityId) || !/^[0-9]{1,20}$/.test(String(row.activityId)) || BigInt(String(row.activityId)) === 0n
      || typeof row.startTimeLocal !== 'string' || row.startTimeLocal.slice(0,10) !== date) throw new BadRequestException('Invalid Garmin activity date or identity.');
    return `native:${BigInt(String(row.activityId))}`;
  });
  if (new Set(identities).size !== identities.length) throw new BadRequestException('Repeated Garmin activity identity.');
  return { identities, complete: value.complete };
}
/** Explicit disclosure removes upstream account/auth/storage fields recursively. */
export function publicGarminPayload(value: Json, depth = 0): Json {
  if (depth > 32) return null;
  if (Array.isArray(value)) return value.map(item => publicGarminPayload(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/user|profile|owner|account|password|token|credential|authorization|cookie|path|hash|objectkey|storage|displayname/i.test(key))
    .map(([key,item]) => [key, publicGarminPayload(item, depth + 1)]));
  return value;
}

/** Endpoint availability and recorded metrics are separate: null-only summaries
 * retain their raw context without claiming that a measurement was recorded. */
export function hasGarminDayEvidence(category: GarminDayCategory, projection: Json): boolean {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return false;
  if (category === 'activities') return 'identities' in projection || 'count' in projection;
  if (category === 'weight') return Array.isArray(projection.measurements) && projection.measurements.length > 0;
  return Object.values(projection).some(value => typeof value === 'number');
}
