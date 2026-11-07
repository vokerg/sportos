/**
 * Automatic Garmin rich-data ingestion is deliberately opt-in by sport.
 *
 * These sports currently have retained-FIT consumers (running efforts,
 * swim lengths, timelines/route, detailed metrics or strength scoring).
 * Walking, rowing, SUP and unknown provider types remain visible in the
 * day discovery, but are never full-FIT downloaded by a day refresh.
 * The explicit single-activity fetch remains available for every sport
 * supported by the Garmin extractor.
 */
const AUTO_RICH_GARMIN_TYPES = new Set([
  'running', 'treadmill_running', 'track_running', 'trail_running',
  'cycling', 'indoor_cycling',
  'lap_swimming', 'open_water_swimming',
  'strength_training',
]);

export function autoRichGarminIdentity(item: unknown): string | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;
  const type = row.activityType;
  if (!type || typeof type !== 'object' || Array.isArray(type)) return null;
  const key = (type as Record<string, unknown>).typeKey;
  if (typeof key !== 'string' || !AUTO_RICH_GARMIN_TYPES.has(key)) return null;
  const id = row.activityId;
  if ((typeof id !== 'string' && typeof id !== 'number')
      || !/^[0-9]{1,20}$/.test(String(id)) || BigInt(String(id)) === 0n) return null;
  return `native:${BigInt(String(id))}`;
}

export function autoRichGarminIdentities(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const items = (payload as Record<string, unknown>).items;
  return Array.isArray(items) ? items.flatMap(item => {
    const identity = autoRichGarminIdentity(item);
    return identity ? [identity] : [];
  }) : [];
}
