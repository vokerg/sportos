/** Presentation-only telemetry; never used for canonical facts or scoring. */
export type TimelineSource = 'strava' | 'garmin';
export interface TimelineMetric {
  key: string; label: string; unit: string; points: [number, number | null][];
}
export interface ActivityTimeline {
  source: TimelineSource;
  status: 'available' | 'unavailable';
  reason?: string;
  durationS: number;
  sampleCount: number;
  simplified: boolean;
  metrics: TimelineMetric[];
}
export const MAX_TIMELINE_SAMPLES = 150_000;
const MAX_DURATION = 7 * 86400;
const definitions = [
  ['pace', 'Pace', 'min/km'], ['heartRate', 'Heart rate', 'bpm'], ['power', 'Power', 'W'],
  ['speed', 'Speed', 'km/h'], ['cadence', 'Cadence', 'rpm'], ['elevation', 'Elevation', 'm'],
  ['temperature', 'Temperature', '°C'], ['distance', 'Distance', 'km'],
  ['groundContact', 'Ground contact time', 'ms'], ['verticalOscillation', 'Vertical oscillation', 'mm'],
] as const;
export const TIMELINE_FIT_FIELDS = ['timestamp', 'enhanced_speed', 'speed', 'heart_rate', 'power', 'cadence',
  'enhanced_altitude', 'altitude', 'temperature', 'distance', 'stance_time', 'vertical_oscillation'];
const object = (x: unknown): Record<string, unknown> | null => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function unavailableTimeline(source: TimelineSource, reason: string): ActivityTimeline {
  return { source, status: 'unavailable', reason, durationS: 0, sampleCount: 0, simplified: false, metrics: [] };
}
function value(key: string, x: unknown): number | null {
  if (!finite(x)) return null;
  if (key === 'pace') return x > 0 && x <= 100 ? 1000 / x / 60 : null;
  if (key === 'speed') return x >= 0 && x <= 100 ? x * 3.6 : null;
  if (key === 'distance') return x >= 0 && x <= 10_000_000 ? x / 1000 : null;
  if (key === 'heartRate') return x > 0 && x <= 300 ? x : null;
  if (key === 'power') return x >= 0 && x <= 5000 ? x : null;
  if (key === 'cadence') return x >= 0 && x <= 300 ? x : null;
  if (key === 'temperature') return x >= -100 && x <= 100 ? x : null;
  if (key === 'elevation') return x >= -1000 && x <= 10000 ? x : null;
  return x >= 0 && x <= 1000 ? x : null;
}
/** Keep extrema and a missing marker per bucket. Never connect missing samples
 * or a >30s recording gap after reducing display resolution. Originals stay intact. */
export function simplify(points: TimelineMetric['points']): TimelineMetric['points'] {
  if (points.length <= 3000) return points;
  const result: TimelineMetric['points'] = [];
  const size = Math.ceil(points.length / 700);
  for (let offset = 0; offset < points.length; offset += size) {
    const end = Math.min(points.length, offset + size);
    let min = offset, max = offset, gap = -1;
    for (let i = offset; i < end; i++) {
      const v = points[i]![1];
      if (v === null) gap = i;
      else {
        if (points[min]![1] === null || v < points[min]![1]!) min = i;
        if (points[max]![1] === null || v > points[max]![1]!) max = i;
      }
    }
    // If a bucket contains missing evidence, suppress its interior rather than
    // drawing through a short gap lost during simplification.
    const indices = gap >= 0 ? [offset, gap, end - 1] : [offset, min, max, end - 1];
    for (const i of [...new Set(indices)].sort((a, b) => a - b)) result.push(points[i]!);
  }
  return result;
}
function finish(source: TimelineSource, times: number[], values: Record<string, unknown[]>): ActivityTimeline {
  if (!times.length || times.length > MAX_TIMELINE_SAMPLES) return unavailableTimeline(source, 'sample_limit_or_missing');
  if (times.some((t, i) => !finite(t) || t < 0 || t > MAX_DURATION || (i > 0 && t <= times[i - 1]!))) return unavailableTimeline(source, 'invalid_timeline');
  const metrics: TimelineMetric[] = [];
  let simplified = false;
  for (const [key, label, unit] of definitions) {
    const data = values[key];
    if (!data || data.length !== times.length) continue;
    const points: TimelineMetric['points'] = [];
    for (let i = 0; i < times.length; i++) {
      if (i && times[i]! - times[i - 1]! > 30) points.push([times[i - 1]! + 0.001, null]);
      points.push([times[i]!, value(key, data[i])]);
    }
    if (!points.some(p => p[1] !== null)) continue;
    const reduced = simplify(points); simplified ||= reduced.length < points.length;
    metrics.push({key, label, unit, points: reduced});
  }
  if (!metrics.length) return unavailableTimeline(source, 'no_supported_metrics');
  return { source, status: 'available', durationS: times[times.length - 1]!, sampleCount: times.length, simplified, metrics };
}
export function stravaTimeline(payload: unknown): ActivityTimeline {
  const streams = object(payload) ?? (Array.isArray(payload) ? Object.fromEntries(payload.flatMap(s => {
    const item = object(s); return typeof item?.type === 'string' ? [[item.type, item]] : [];
  })) : {});
  const timeStream = object(streams.time);
  const times = timeStream?.data;
  if (!Array.isArray(times) || times.length > MAX_TIMELINE_SAMPLES || !times.every(finite)) return unavailableTimeline('strava', 'sample_limit_or_missing');
  const values: Record<string, unknown[]> = {};
  for (const [key, native] of Object.entries({pace:'velocity_smooth', speed:'velocity_smooth', heartRate:'heartrate', power:'watts', cadence:'cadence', elevation:'altitude', temperature:'temp', distance:'distance'})) {
    const stream = object(streams[native]);
    // Equal lengths alone do not establish alignment when provider metadata differs.
    if (stream && Array.isArray(stream.data) && stream.data.length === times.length
      && ['series_type','resolution','original_size'].every(field => stream[field] === timeStream?.[field])) values[key] = stream.data;
  }
  return finish('strava', times, values);
}
export function garminTimeline(messages: unknown[]): ActivityTimeline {
  if (messages.length > MAX_TIMELINE_SAMPLES) return unavailableTimeline('garmin', 'sample_limit_or_missing');
  const times: number[] = [], values: Record<string, unknown[]> = Object.fromEntries(definitions.map(([key]) => [key, []]));
  let start: number | undefined;
  for (const raw of messages) {
    const msg = object(raw);
    if (msg?.message !== 'record') continue;
    if (!Array.isArray(msg.fields)) return unavailableTimeline('garmin', 'invalid_timeline');
    const fields = new Map<string, Record<string, unknown>>();
    for (const rawField of msg.fields) {
      const field = object(rawField);
      if (!field || typeof field.name !== 'string' || !TIMELINE_FIT_FIELDS.includes(field.name)) continue;
      // Developer fields with the same name are not known native semantics.
      if (field.developerIndex !== undefined && field.developerIndex !== null) continue;
      if (fields.has(field.name)) return unavailableTimeline('garmin', 'invalid_timeline');
      fields.set(field.name, field);
    }
    const timestamp = fields.get('timestamp')?.value;
    if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|\+00:00)$/.test(timestamp)) return unavailableTimeline('garmin', 'invalid_timeline');
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) return unavailableTimeline('garmin', 'invalid_timeline');
    start ??= ms;
    times.push((ms - start) / 1000);
    const read = (name: string, unit: string) => { const f = fields.get(name); return f?.units === unit ? f.value : null; };
    const speed = read('enhanced_speed', 'm/s') ?? read('speed', 'm/s');
    const row: Record<string, unknown> = { pace:speed, speed, heartRate:read('heart_rate','bpm'), power:read('power','watts'), cadence:read('cadence','rpm'), elevation:read('enhanced_altitude','m') ?? read('altitude','m'), temperature:read('temperature','C'), distance:read('distance','m'), groundContact:read('stance_time','ms'), verticalOscillation:read('vertical_oscillation','mm') };
    for (const [key] of definitions) values[key]!.push(row[key]);
  }
  return finish('garmin', times, values);
}
