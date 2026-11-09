/** Native Garmin Connect JSON. Never represented as decoded FIT messages. */
export const GARMIN_JSON_POLICY_VERSION = 1;
export function connectObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function connectChart(payload: unknown): Record<string, (number | null)[]> | null {
  const data = connectObject(payload), descriptors = data.metricDescriptors, rows = data.activityDetailMetrics;
  if (data.pendingData === true || !Array.isArray(descriptors) || !Array.isArray(rows) || rows.length < 2 || rows.length > 150000 || data.totalMetricsCount !== rows.length) return null;
  const columns: Record<string, (number | null)[]> = {}, indexes = new Set<number>();
  for (const item of descriptors) {
    const descriptor = connectObject(item), key = descriptor.key, index = descriptor.metricsIndex;
    if (typeof key !== 'string' || Object.hasOwn(columns,key) || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || indexes.has(index)) return null;
    indexes.add(index);
    const column: (number | null)[] = [];
    for (const row of rows) {
      const metrics = connectObject(row).metrics;
      if (!Array.isArray(metrics) || index >= metrics.length) return null;
      const value: unknown = metrics[index];
      column.push(typeof value === 'number' && Number.isFinite(value) ? value : null);
    }
    columns[key] = column;
  }
  const times = columns.directTimestamp;
  if (!times || times.some((t,i) => t === null || (i > 0 && (t <= times[i-1]! || t-times[i-1]! > 30000)))) return null;
  return columns;
}
export function connectContinuousRun(summary: unknown, chart: Record<string,(number|null)[]>): boolean {
  const s = connectObject(summary), duration = s.duration, elapsed = s.elapsedDuration;
  if (typeof duration !== 'number' || typeof elapsed !== 'number' || !Number.isFinite(duration) || !Number.isFinite(elapsed) || duration <= 0 || Math.abs(duration-elapsed) > .1) return false;
  const times = chart.directTimestamp, timer = chart.sumDuration, distance = chart.sumDistance;
  return Boolean(times && timer && distance && times.length === timer.length && times.length === distance.length
    && timer.every((v,i) => v !== null && distance[i] !== null && (i === 0 || (distance[i]! >= distance[i-1]! && Math.abs(v-timer[i-1]!-(times[i]!-times[i-1]!)/1000) <= .02))));
}
/** Check the executable JSON publication contract rather than trusting a caller's
 * feature labels. All expected native resources must precede primary publish. */
export function completeConnectBundle(detail: unknown, splits: unknown, sets: unknown): boolean {
  const root=connectObject(detail), acquisition=connectObject(root.acquisition), metadata=connectObject(root.metadata), summary=connectObject(metadata.summaryDTO);
  if (acquisition.version !== GARMIN_JSON_POLICY_VERSION || acquisition.kind !== 'json' || !Array.isArray(acquisition.fallbackReasons) || acquisition.fallbackReasons.length) return false;
  const sport=connectObject(metadata.activityTypeDTO).typeKey;
  const chart=connectChart(root.details);
  if (!chart || typeof summary.elapsedDuration !== 'number' || summary.elapsedDuration < 0) return false;
  const expected=acquisition.expectedResources;
  if (!Array.isArray(expected) || expected.length!==3 || !['detail','sets','laps'].every(key=>expected.filter(x=>connectObject(x).resourceType===key && connectObject(x).chunkIndex===0).length===1)) return false;
  if (sport==='strength_training') return Boolean(sets && typeof sets==='object' && !Array.isArray(sets));
  if (!['running','treadmill_running','track_running','trail_running','cycling','indoor_cycling','open_water_swimming'].includes(String(sport))) return false;
  const laps=connectObject(splits).lapDTOs;
  if (!Array.isArray(laps) || laps.length<1 || laps.length>100 || laps.some(x=>typeof connectObject(x).duration!=='number' || typeof connectObject(x).elapsedDuration!=='number')) return false;
  return !String(sport).includes('running') || connectContinuousRun(summary,chart);
}
