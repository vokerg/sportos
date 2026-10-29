/** Retained FIT length messages are not Strava laps or second-by-second streams.
 * Display only evidenced pool splits; never adjust canonical distance or scoring. */
export type SwimLengthKind = 'active' | 'rest' | 'unknown';
export interface SwimLength {
  row: number;
  lengthNumber: number | null;
  kind: SwimLengthKind;
  durationS: number | null;
  durationBasis: 'timer' | 'elapsed' | null;
  paceSPer100M: number | null;
  strokes: number | null;
  swolf: number | null;
  stroke: string | null;
}
export interface SwimLengths {
  status: 'available' | 'unavailable';
  reason?: string;
  poolLengthM: number | null;
  poolLengthDisplay: string | null;
  expectedLengths: number | null;
  expectedActiveLengths: number | null;
  recordedDistanceM?: number | null;
  effectiveDistanceM?: number | null;
  effectiveActiveLengths?: number | null;
  complete: boolean | null;
  truncated: boolean;
  lengths: SwimLength[];
}
export function unavailableSwimLengths(reason: string): SwimLengths {
  return {
    status: 'unavailable',
    reason,
    poolLengthM: null,
    poolLengthDisplay: null,
    expectedLengths: null,
    expectedActiveLengths: null,
    complete: null,
    truncated: false,
    lengths: [],
  };
}
function isObject(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);
}
function fields(raw: unknown): Map<string, { value: unknown; units: unknown }> {
  if (!isObject(raw) || !Array.isArray(raw.fields)) return new Map();
  const mapped = new Map<string, { value: unknown; units: unknown }>();
  const seen = new Set<string>();
  for (const field of raw.fields) {
    if (
      !isObject(field) ||
      typeof field.name !== 'string' ||
      (field.developerIndex !== null && field.developerIndex !== undefined)
    )
      continue;
    // Conflicting native fields have no deterministic interpretation.
    if (seen.has(field.name)) {
      mapped.delete(field.name);
      continue;
    }
    seen.add(field.name);
    mapped.set(field.name, { value: field.value, units: field.units });
  }
  return mapped;
}
function number(
  field: { value: unknown; units: unknown } | undefined,
  unit: string | null,
  min: number,
  max: number,
) {
  if (
    !field ||
    typeof field.value !== 'number' ||
    !Number.isFinite(field.value) ||
    field.value < min ||
    field.value > max ||
    (unit === null
      ? field.units !== null && field.units !== '' && field.units !== undefined
      : field.units !== unit)
  )
    return null;
  return field.value;
}
function count(field: { value: unknown; units: unknown } | undefined, unit: string) {
  if (!field || ![null, undefined, '', unit].includes(field.units as string | null | undefined))
    return null;
  const n = number({ ...field, units: null }, null, 0, 10000);
  return n !== null && Number.isInteger(n) ? n : null;
}
export function parseSwimLengths(session: unknown, raw: unknown[], truncated = false): SwimLengths {
  if (!isObject(session) || session.message !== 'session')
    return unavailableSwimLengths('missing_session');
  if (!raw.length) return unavailableSwimLengths('no_length_messages');
  const sessionFields = fields(session);
  const lengthField = sessionFields.get('pool_length');
  const size = number(lengthField, 'm', 1, 200);
  // FIT decoded pool_length is metres. A different or unrecognized unit is not guessed.
  const poolLengthM = size;
  const expectedLengths = count(sessionFields.get('num_lengths'), 'lengths');
  const expectedActiveLengths = count(sessionFields.get('num_active_lengths'), 'lengths');
  let active = 0;
  const lengths: SwimLength[] = [];
  for (const message of raw) {
    if (!isObject(message) || message.message !== 'length') continue;
    const row = fields(message);
    const type = row.get('length_type')?.value;
    const kind: SwimLengthKind =
      type === 'active' ? 'active' : type === 'idle' ? 'rest' : 'unknown';
    if (kind === 'active') active++;
    const timer = number(row.get('total_timer_time'), 's', 0, 86400);
    const elapsed = number(row.get('total_elapsed_time'), 's', 0, 86400);
    const durationS = timer ?? elapsed;
    const strokes = kind === 'active' ? count(row.get('total_strokes'), 'strokes') : null;
    const paceSPer100M =
      kind === 'active' && poolLengthM && durationS !== null && durationS > 0
        ? (durationS * 100) / poolLengthM
        : null;
    const strokeType = row.get('swim_stroke')?.value;
    lengths.push({
      row: lengths.length + 1,
      lengthNumber: kind === 'active' ? active : null,
      kind,
      durationS,
      durationBasis: timer !== null ? 'timer' : elapsed !== null ? 'elapsed' : null,
      paceSPer100M,
      strokes,
      // FIT length SWOLF is split seconds + strokes. Only calculate when the
      // active timer and native total strokes are both present.
      swolf:
        kind === 'active' && timer !== null && timer > 0 && strokes !== null
          ? timer + strokes
          : null,
      stroke:
        typeof strokeType === 'string' && /^[a-z_]{1,32}$/.test(strokeType)
          ? strokeType.replaceAll('_', ' ')
          : null,
    });
  }
  if (!lengths.length) return unavailableSwimLengths('no_length_messages');
  // Both counts matter: total count agreement cannot hide a missing active
  // length replaced by an idle or unrecognized message.
  const mismatched =
    (expectedLengths !== null && expectedLengths !== lengths.length) ||
    (expectedActiveLengths !== null && expectedActiveLengths !== active);
  const complete =
    truncated || mismatched || lengths.some((row) => row.kind === 'unknown')
      ? false
      : expectedLengths !== null || expectedActiveLengths !== null
        ? true
        : null;
  return {
    status: 'available',
    poolLengthM,
    poolLengthDisplay: poolLengthM === null ? null : `${Number(poolLengthM.toFixed(2))} m`,
    expectedLengths,
    expectedActiveLengths,
    complete,
    truncated,
    lengths,
  };
}
