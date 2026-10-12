export interface RunningEffort {
  targetDistanceM: number; method: 'summary_estimate' | 'stream_calculated' | 'fit_calculated';
  status: 'estimated' | 'calculated' | 'unavailable'; reason: string | null;
  durationS: number | null; sourceDistanceM: number | null; coverageDistanceM: number | null;
  startOffsetS: number | null; endOffsetS: number | null;
  pausePolicy: 'summary_moving' | 'moving_flags' | 'timer_events'; pauseCoverage: 'summary' | 'validated' | 'unknown';
}
export interface EffortProvider {
  provider: 'strava' | 'garmin'; state: 'current' | 'unprocessed' | 'stale' | 'failed' | 'not_linked';
  projectedAt: string | null; algorithmVersion: number | null; efforts: RunningEffort[];
}
export interface RunningEfforts { targets: number[]; providers: EffortProvider[]; }
export function effortMethod(method: RunningEffort['method']) {
  return method === 'summary_estimate' ? 'Strava summary · average pace' : method === 'stream_calculated' ? 'Strava streams · moving time' : 'Garmin FIT · timer-active time';
}
export function effortStatus(provider: EffortProvider, effort: RunningEffort) {
  return provider.state === 'stale' ? 'Stale' : provider.state === 'failed' ? 'Failed' : effort.status === 'calculated' ? 'Calculated' : effort.status === 'estimated' ? 'Estimated' : 'Unavailable';
}
export function effortTime(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const rounded = Math.round(seconds), h = Math.floor(rounded / 3600), m = Math.floor(rounded / 60) % 60, s = String(rounded % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
export function effortDistance(m: number) { return m === 21097.5 ? '21.1 km' : `${m / 1000} km`; }
const reasons: Record<string, string> = {
  sample_limit_or_missing_records: 'Samples are missing or exceed the bounded processing limit.', multiple_or_missing_fit_sessions: 'A single complete FIT session is required.',
  missing_or_invalid_fit_distance: 'Native FIT distance in metres is missing or invalid.', invalid_fit_timestamp: 'A native UTC FIT timestamp is missing or invalid.',
  duplicate_fit_field: 'Native FIT fields are duplicated.', invalid_fit_fields: 'FIT fields are malformed.', ambiguous_timer_group: 'Multiple timer groups cannot establish active time.',
  activity_duration_limit: 'The recorded timeline exceeds the supported duration.', invalid_window: 'No trustworthy window covers this distance.',
  too_short: 'Recorded distance is too short.', no_strava_link: 'No Strava source link.', no_garmin_link: 'No Garmin source link.', not_processed: 'Calculate retained efforts to inspect available evidence.',
  streams_not_retained: 'Rich streams are not retained.', stale_streams: 'Retained streams belong to an older summary.', streams_unavailable: 'Strava streams were unavailable.',
  missing_or_invalid_strava_summary: 'Valid Strava distance and moving time are unavailable.', no_fit_records: 'FIT records are not retained.', incomplete_fit_resources: 'The retained FIT resource bundle is incomplete.',
  insufficient_pause_evidence: 'Timer start/stop coverage is insufficient.', inconsistent_timer_events: 'Timer events are inconsistent.', unknown_timer_event: 'Timer event type is unsupported.',
  distance_during_pause_or_transition: 'Distance crosses an uncertain timer boundary.', unknown_recording_gap: 'No continuous measured window covers this target because recording gaps exceed 30 seconds.',
  partial_stream_coverage: 'Fastest window within continuous retained sections; recording gaps are excluded.',
  duplicate_or_nonmonotonic_time: 'Timestamps are duplicated or out of order.', distance_reset: 'Cumulative distance resets.', implausible_distance_jump: 'Distance jumps exceed the running speed limit.',
  missing_or_misaligned_streams: 'Time, distance and moving streams are missing or misaligned.', invalid_stream_sample: 'A stream sample is invalid.', misaligned_stream_metadata: 'Stream sampling metadata disagrees.',
  source_or_algorithm_changed: 'The source or calculation version changed; calculate retained efforts again.', retained_read_failed: 'Retained evidence could not be read; retry processing.', projection_failed: 'Results could not be saved; retry processing.',
};
export function effortReason(reason: string | null) { return reason ? reasons[reason] ?? 'Retained evidence is insufficient or unsupported.' : ''; }
