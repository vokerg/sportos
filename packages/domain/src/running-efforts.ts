/** Independent analytical running windows. No canonical/scoring dependency. */
export const RUNNING_EFFORT_ALGORITHM_VERSION = 5;
export const RUNNING_EFFORT_TARGETS = [5000, 10000, 15000, 20000, 21097.5, 25000, 42195] as const;
export const RUNNING_EFFORT_LIMITS = { samples: 200000, events: 10000, gapS: 30, speedMps: 12, distanceM: 1000000, durationS: 604800, pauseBoundaryDistanceM: 10 } as const;
export function runningEffortDistanceTolerance(targetM: number): number { return Math.min(10, targetM * .001); }
export type EffortMethod = 'summary_estimate' | 'stream_calculated' | 'fit_calculated';
export type EffortStatus = 'estimated' | 'calculated' | 'unavailable';
export interface RunningEffort {
  targetDistanceM: number; method: EffortMethod; status: EffortStatus; reason: string | null;
  durationS: number | null; sourceDistanceM: number | null; coverageDistanceM: number | null;
  startOffsetS: number | null; endOffsetS: number | null;
  pausePolicy: 'summary_moving' | 'moving_flags' | 'timer_events'; pauseCoverage: 'summary' | 'validated' | 'unknown';
}
interface Point { t: number; d: number; active: number; boundedPauses?: number; }
export function unavailableEfforts(method: EffortMethod, reason: string, distance: number | null = null): RunningEffort[] {
  return RUNNING_EFFORT_TARGETS.map(targetDistanceM => ({ targetDistanceM, method, status: 'unavailable', reason,
    durationS: null, sourceDistanceM: distance, coverageDistanceM: null, startOffsetS: null, endOffsetS: null,
    pausePolicy: method === 'fit_calculated' ? 'timer_events' : method === 'stream_calculated' ? 'moving_flags' : 'summary_moving', pauseCoverage: 'unknown' }));
}
export function estimateStravaEfforts(distance: unknown, moving: unknown, reason = 'streams_not_retained'): RunningEffort[] {
  if (!positive(distance, RUNNING_EFFORT_LIMITS.distanceM) || !positive(moving, RUNNING_EFFORT_LIMITS.durationS) || distance / moving > RUNNING_EFFORT_LIMITS.speedMps)
    return unavailableEfforts('summary_estimate', 'missing_or_invalid_strava_summary');
  return unavailableEfforts('summary_estimate', reason, distance).map(row => ({ ...row,
    status: distance >= row.targetDistanceM ? 'estimated' : 'unavailable', reason: distance >= row.targetDistanceM ? reason : 'too_short',
    durationS: distance >= row.targetDistanceM ? row.targetDistanceM * moving / distance : null,
    coverageDistanceM: distance, pauseCoverage: 'summary' }));
}
export function stravaStreamEfforts(payload: unknown): RunningEffort[] {
  try {
    const streams = object(payload);
    const time = object(streams.time).data, distance = object(streams.distance).data, moving = object(streams.moving).data;
    if (!Array.isArray(time) || !Array.isArray(distance) || !Array.isArray(moving) || time.length !== distance.length || time.length !== moving.length) fail('missing_or_misaligned_streams');
    if (time.length < 2 || time.length > RUNNING_EFFORT_LIMITS.samples) fail('sample_limit_or_missing_records');
    // Different base/resolution/declared lengths indicate independently sampled streams.
    const descriptors = ['time', 'distance', 'moving'].map(key => object(streams[key]));
    for (const key of ['series_type', 'resolution', 'original_size']) {
      const values = descriptors.map(s => s[key]);
      if (values.some(v => v !== undefined) && !values.every(v => v === values[0])) fail('misaligned_stream_metadata');
    }
    let points: Point[] = []; const sections: Point[][] = []; let active = 0, stoppedDistance = 0, boundedPauses = 0;
    for (let i = 0; i < time.length; i++) {
      const t = time[i], d = distance[i], m = moving[i];
      if (!nonnegative(t, RUNNING_EFFORT_LIMITS.durationS) || !nonnegative(d, RUNNING_EFFORT_LIMITS.distanceM) || typeof m !== 'boolean') fail('invalid_stream_sample');
      if (i) {
        const previous = points.at(-1)!; const dt = t - previous.t, dd = d - distance[i - 1];
        progression(dt, dd);
        // Ordinary intervals use both bounding stopped flags. Slow active
        // running is retained; sparse stop markers have a separate bound below.
        // A sparse stop marker bracketed by active samples can represent a
        // pause rather than missing running. This is an explicit bounded
        // convention, qualified on every window that crosses the boundary.
        const boundedPause = dt > RUNNING_EFFORT_LIMITS.gapS && moving[i - 1] === true && m === false
          && dd <= RUNNING_EFFORT_LIMITS.pauseBoundaryDistanceM && moving[i + 1] === true
          && nonnegative(time[i + 1], RUNNING_EFFORT_LIMITS.durationS) && time[i + 1] > t && time[i + 1] - t <= RUNNING_EFFORT_LIMITS.gapS;
        const isActive = !boundedPause && (m || moving[i - 1] === true);
        if (isActive && dt > RUNNING_EFFORT_LIMITS.gapS) {
          // Unknown time/distance cannot join two measured windows. Retain only
          // independently continuous coverage on either side of the gap.
          sections.push(points); points = [{ t, d, active: 0 }];
          active = 0; stoppedDistance = 0; boundedPauses = 0; continue;
        }
        // Stopped movement/drift contributes neither running distance nor time.
        // Validate raw progression above, independently of this active distance.
        interval(dt, isActive ? dd : 0, isActive ? dt : 0);
        active += isActive ? dt : 0;
        if (!isActive) stoppedDistance += dd;
        if (boundedPause) boundedPauses++;
      }
      points.push({ t, d: d - stoppedDistance, active, boundedPauses });
    }
    if (!sections.length) return windows(points, 'stream_calculated', distance.at(-1));
    sections.push(points);
    const selected: (RunningEffort | undefined)[] = []; let coverage = 0;
    for (const section of sections) {
      const rows = windows(section, 'stream_calculated', distance.at(-1), time[0]);
      coverage = Math.max(coverage, rows[0].coverageDistanceM!);
      rows.forEach((candidate, i) => {
        const best = selected[i];
        if (candidate.status === 'calculated' && (!best || candidate.durationS! < best.durationS! - 1e-9)) selected[i] = candidate;
      });
    }
    return unavailableEfforts('stream_calculated', 'unknown_recording_gap', distance.at(-1)).map((row, i) => {
      const best = selected[i];
      return best ? { ...best, reason: best.reason ? 'partial_stream_coverage_with_tolerance' : 'partial_stream_coverage' } : { ...row, coverageDistanceM: coverage, pauseCoverage: 'validated' };
    });
  } catch (error) { return unavailableEfforts('stream_calculated', reason(error)); }
}
/** Current extractor's decoded fields array, including native units and ISO UTC. */
export function garminFitEfforts(messages: readonly unknown[]): RunningEffort[] {
  try {
    if (messages.length > RUNNING_EFFORT_LIMITS.samples + RUNNING_EFFORT_LIMITS.events + 1) fail('sample_limit_or_missing_records');
    const records: { t: number; d: number }[] = [], events: { t: number; start: boolean }[] = [];
    for (const raw of messages) {
      const message = object(raw);
      if (message.message !== 'record' && message.message !== 'event') continue;
      const fields = fitFields(message.fields);
      if (message.message === 'event') {
        if (fields.event?.value !== 'timer' && fields.event?.value !== 0) continue;
        const type = fields.event_type?.value;
        const start = type === 'start' || type === 0;
        if (!start && !['stop', 'stop_all', 'stop_disable', 'stop_disable_all', 1, 4, 8, 9].includes(type as never)) fail('unknown_timer_event');
        const group = fields.event_group?.value;
        if (group !== undefined && group !== null && group !== 0) fail('ambiguous_timer_group');
        events.push({ t: timestamp(fields.timestamp), start });
      } else {
        const distance = fields.distance;
        if (distance?.units !== 'm' || !nonnegative(distance.value, RUNNING_EFFORT_LIMITS.distanceM)) fail('missing_or_invalid_fit_distance');
        records.push({ t: timestamp(fields.timestamp), d: distance.value });
      }
    }
    if (records.length < 2 || records.length > RUNNING_EFFORT_LIMITS.samples) fail('sample_limit_or_missing_records');
    if (events.length < 2 || events.length > RUNNING_EFFORT_LIMITS.events || !events[0].start || events.at(-1)!.start) fail('insufficient_pause_evidence');
    const spans: { start: number; end: number }[] = [];
    for (let i = 0; i < events.length; i++) {
      if (i && (events[i].t < events[i - 1].t || events[i].start === events[i - 1].start)) fail('inconsistent_timer_events');
      if (!events[i].start) spans.push({ start: events[i - 1].t, end: events[i].t });
    }
    if (records.at(-1)!.t - records[0].t > RUNNING_EFFORT_LIMITS.durationS) fail('activity_duration_limit');
    if (events[0].t > records[0].t || events.at(-1)!.t < records.at(-1)!.t) fail('insufficient_pause_evidence');
    const points: Point[] = []; let active = 0, spanIndex = 0, stoppedDistance = 0;
    for (let i = 0; i < records.length; i++) {
      const current = records[i];
      if (i) {
        const prev = records[i - 1], dt = current.t - prev.t, dd = current.d - prev.d;
        progression(dt, dd);
        while (spanIndex < spans.length && spans[spanIndex].end <= prev.t) spanIndex++;
        let activeS = 0;
        for (let j = spanIndex; j < spans.length && spans[j].start < current.t; j++) activeS += Math.max(0, Math.min(current.t, spans[j].end) - Math.max(prev.t, spans[j].start));
        // A traveled interval straddling a timer transition lacks a known
        // distance at that transition. Do not allocate it invented active time.
        if (dd > 0 && activeS > 0 && Math.abs(activeS - dt) > 1e-6) fail('distance_during_pause_or_transition');
        interval(dt, activeS > 0 ? dd : 0, activeS); active += activeS;
        if (activeS === 0) stoppedDistance += dd;
      }
      points.push({ t: current.t, d: current.d - stoppedDistance, active });
    }
    return windows(points, 'fit_calculated', records.at(-1)!.d);
  } catch (error) { return unavailableEfforts('fit_calculated', reason(error)); }
}
function windows(points: Point[], method: EffortMethod, sourceDistance: number, firstTime = points[0].t): RunningEffort[] {
  const first = points[0], last = points.at(-1)!; const coverage = last.d - first.d;
  return unavailableEfforts(method, 'too_short', sourceDistance).map(row => {
    row.coverageDistanceM = coverage; row.pauseCoverage = 'validated';
    if (coverage <= 0 || row.targetDistanceM - coverage > runningEffortDistanceTolerance(row.targetDistanceM) + 1e-9) return row;
    // Use the actual measured window and duration; no invented terminal sample,
    // distance, time or offset is added when accepting a tiny shortfall.
    const measuredTarget = Math.min(row.targetDistanceM, coverage), tolerated = measuredTarget < row.targetDistanceM;
    let best: { duration: number; start: number; end: number; boundedPause: boolean } | null = null;
    const consider = (d: number) => {
      if (d < first.d || d + measuredTarget > last.d) return;
      const start = boundary(points, d, true), end = boundary(points, d + measuredTarget, false);
      const duration = end.active - start.active;
      if (duration <= 0 || row.targetDistanceM / duration > RUNNING_EFFORT_LIMITS.speedMps) return;
      if (!best || duration < best.duration - 1e-9 || (Math.abs(duration - best.duration) <= 1e-9 && start.t < best.start)) best = { duration, start: start.t, end: end.t, boundedPause: (end.boundedPauses ?? 0) > (start.boundedPauses ?? 0) };
    };
    // For piecewise-linear time(distance), minima occur at a start or end
    // breakpoint. Checking both finds fractional boundaries, not just laps.
    for (const point of points) { consider(point.d); consider(point.d - measuredTarget); }
    if (!best) return { ...row, reason: 'invalid_window' };
    const selected = best as { duration: number; start: number; end: number; boundedPause: boolean };
    const qualification = tolerated ? selected.boundedPause ? 'distance_and_pause_tolerance' : 'distance_tolerance' : selected.boundedPause ? 'bounded_pause_boundary' : null;
    return { ...row, status: 'calculated', reason: qualification, durationS: selected.duration,
      startOffsetS: selected.start - firstTime, endOffsetS: selected.end - firstTime };
  });
}
function boundary(points: Point[], d: number, start: boolean): Point {
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].d < d || (start && points[mid].d === d)) lo = mid + 1; else hi = mid; }
  if (start && lo && points[lo - 1].d === d) return points[lo - 1];
  if (!start && lo < points.length && points[lo].d === d) return points[lo];
  const a = points[lo - 1], b = points[lo], f = (d - a.d) / (b.d - a.d);
  return { d, t: a.t + f * (b.t - a.t), active: a.active + f * (b.active - a.active), boundedPauses: a.boundedPauses };
}
function progression(dt: number, dd: number) { if (!(dt > 0)) fail('duplicate_or_nonmonotonic_time'); if (dd < 0) fail('distance_reset'); }
function interval(dt: number, dd: number, active: number) {
  if (active > 0 && dt > RUNNING_EFFORT_LIMITS.gapS) fail('unknown_recording_gap');
  if (active === 0 && dd > 0) fail('distance_during_pause_or_transition');
  if (dd > 0 && (active <= 0 || dd / active > RUNNING_EFFORT_LIMITS.speedMps)) fail('implausible_distance_jump');
}
function object(v: unknown): Record<string, unknown> { return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
function fitFields(v: unknown): Record<string, { value: unknown; units: unknown }> {
  if (!Array.isArray(v) || v.length > 512) fail('invalid_fit_fields');
  const out: Record<string, { value: unknown; units: unknown }> = {};
  for (const raw of v) { const f = object(raw); if (typeof f.name !== 'string' || f.developerIndex != null) continue;
    if (out[f.name]) fail('duplicate_fit_field'); out[f.name] = { value: f.value, units: f.units }; }
  return out;
}
function timestamp(f: { value: unknown; units: unknown } | undefined): number {
  if (!f || (f.units !== 's' && f.units !== null && f.units !== '') || typeof f.value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(f.value)) fail('invalid_fit_timestamp');
  const whole = f.value.replace(/\.\d+/, '');
  const base = Date.parse(whole);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 19) !== whole.slice(0, 19)) fail('invalid_fit_timestamp');
  const fraction = /\.(\d+)/.exec(f.value);
  return base / 1000 + (fraction ? Number(`0.${fraction[1]}`) : 0);
}
function nonnegative(v: unknown, max: number): v is number { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max; }
function positive(v: unknown, max: number): v is number { return nonnegative(v, max) && v > 0; }
class EvidenceError extends Error {}
function fail(message: string): never { throw new EvidenceError(message); }
function reason(error: unknown) { return error instanceof EvidenceError ? error.message : 'invalid_retained_evidence'; }
