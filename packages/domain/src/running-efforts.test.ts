import { describe, expect, it } from 'vitest';
import { estimateStravaEfforts, garminFitEfforts, RUNNING_EFFORT_TARGETS, stravaStreamEfforts } from './running-efforts.js';
function streams(time: number[], distance: number[], moving = time.map(() => true)) { return { time: { data: time }, distance: { data: distance }, moving: { data: moving } }; }
function run(km = 26, pace = 300) { const distance = Array.from({ length: km * 100 + 1 }, (_, i) => i * 10); return streams(distance.map(d => d * pace / 1000), distance); }
function fit(time: number[], distance: number[], events: [number, string][] = [[time[0], 'start'], [time.at(-1)!, 'stop_all']]) {
  const ts = (s: number) => new Date(Date.UTC(2026, 0, 1) + s * 1000).toISOString();
  return [...events.map(([t, type]) => ({ message: 'event', fields: [{ name: 'timestamp', units: 's', value: ts(t) }, { name: 'event', units: null, value: 'timer' }, { name: 'event_type', units: null, value: type }] })),
    ...time.map((t, i) => ({ message: 'record', fields: [{ name: 'timestamp', units: 's', value: ts(t) }, { name: 'distance', units: 'm', value: distance[i] }] }))];
}
describe('independent pause-excluded running efforts', () => {
  it('estimates all catalog targets within the actual Strava summary, with no segment offsets', () => {
    const rows = estimateStravaEfforts(26000, 7800);
    expect(rows.map(r => r.targetDistanceM)).toEqual([...RUNNING_EFFORT_TARGETS]);
    rows.forEach(r => { expect(r.durationS).toBeCloseTo(r.targetDistanceM * .3); expect(r.status).toBe('estimated'); expect(r.startOffsetS).toBeNull(); expect(r.endOffsetS).toBeNull(); });
    expect(estimateStravaEfforts(4999.99, 1500)[0]).toMatchObject({ status: 'unavailable', reason: 'too_short', durationS: null });
    for (const invalid of [null, undefined, 0, -1, Infinity, NaN, '5000']) expect(estimateStravaEfforts(invalid, 1500)[0].status).toBe('unavailable');
    expect(estimateStravaEfforts(5000, 0)[0].status).toBe('unavailable');
    expect(estimateStravaEfforts(5000, 100)[0].status).toBe('unavailable');
  });
  it('fixed pace covers 5/10/15/20/half/25 km with earliest deterministic ties', () => {
    const rows = stravaStreamEfforts(run());
    rows.forEach(r => { expect(r.durationS).toBeCloseTo(r.targetDistanceM * .3); expect(r.status).toBe('calculated'); expect(r.startOffsetS).toBe(0); });
    expect(rows[4].endOffsetS).toBeCloseTo(6329.25);
  });
  it('finds fastest 5 km in the middle and positive/negative splits', () => {
    const d = Array.from({ length: 1001 }, (_, i) => i * 10);
    const t = d.map(v => v <= 2000 ? v * .4 : v <= 7000 ? 800 + (v - 2000) * .25 : 2050 + (v - 7000) * .4);
    expect(stravaStreamEfforts(streams(t, d))[0]).toMatchObject({ durationS: 1250, startOffsetS: 800, endOffsetS: 2050 });
    for (const negative of [true, false]) {
      const time = d.map(v => negative ? v <= 5000 ? v * .4 : 2000 + (v - 5000) * .3 : v <= 5000 ? v * .3 : 1500 + (v - 5000) * .4);
      expect(stravaStreamEfforts(streams(time, d))[0]).toMatchObject({ durationS: 1500, startOffsetS: negative ? 2000 : 0 });
    }
  });
  it('considers end breakpoints as well as sample starts for boundary interpolation', () => {
    const d = Array.from({ length: 701 }, (_, i) => i * 10.3);
    const t = d.map(v => v <= 1800 ? v * .4 : v <= 6200.6 ? 720 + (v - 1800) * .2 : 1600.12 + (v - 6200.6) * .4);
    const row = stravaStreamEfforts(streams(t, d))[0];
    expect(row.status).toBe('calculated'); expect(row.durationS).toBeLessThan(1121); expect(row.durationS).toBeGreaterThan(1119);
    expect(row.startOffsetS! % 1).not.toBe(0);
  });
  it('handles exact-target and fractional over-target data without extrapolation', () => {
    const source = run(5); expect(stravaStreamEfforts(source)[0].durationS).toBe(1500);
    expect(stravaStreamEfforts(source)[1].status).toBe('unavailable');
    source.distance.data.push(5000.1); source.time.data.push(1500.03); source.moving.data.push(true);
    expect(stravaStreamEfforts(source)[0].durationS).toBeCloseTo(1500);
  });
  it('excludes explicit stopped intervals while counting slow active and zero-distance active time', () => {
    const source = run(5); const at = 250;
    source.time.data = [...source.time.data.slice(0, at + 1), 780, 900, ...source.time.data.slice(at + 1).map(t => t + 150)];
    source.distance.data = [...source.distance.data.slice(0, at + 1), 2500, 2500, ...source.distance.data.slice(at + 1)];
    source.moving.data = [...source.moving.data.slice(0, at + 1), false, false, ...source.moving.data.slice(at + 1)];
    expect(stravaStreamEfforts(source)[0].durationS).toBe(1530); // transition counted conservatively, stopped 120 s excluded
    source.moving.data.fill(true); source.time.data[at + 2] = 800;
    source.time.data = source.time.data.map((t, i) => i > at + 2 ? t - 100 : t);
    expect(stravaStreamEfforts(source)[0].durationS).toBe(1550);
  });
  it('rejects missing alignment, moving flags, resets, duplicate times, jumps and active unknown gaps', () => {
    const cases: [unknown, string][] = [
      [{ time: { data: [0, 10] }, distance: { data: [0, 1] } }, 'missing_or_misaligned_streams'],
      [streams([0, 1], [0, 1], [true]), 'missing_or_misaligned_streams'],
      [streams([0, 0], [0, 1]), 'duplicate_or_nonmonotonic_time'],
      [streams([0, 1], [10, 9]), 'distance_reset'],
      [streams([0, 1], [0, 100]), 'implausible_distance_jump'],
      [streams([0, 31], [0, 100]), 'unknown_recording_gap'],
    ];
    for (const [payload, reason] of cases) expect(stravaStreamEfforts(payload)[0]).toMatchObject({ status: 'unavailable', reason });
    const metadata = run(5); Object.assign(metadata.moving, { resolution: 'low' });
    expect(stravaStreamEfforts(metadata)[0].reason).toBe('misaligned_stream_metadata');
  });
  it('uses current decoded FIT fields, native distance and complete timer boundaries', () => {
    const source = run(10, 280);
    const rows = garminFitEfforts(fit(source.time.data, source.distance.data));
    expect(rows[0]).toMatchObject({ status: 'calculated', durationS: 1400, pausePolicy: 'timer_events', pauseCoverage: 'validated' });
    expect(rows[1].durationS).toBeCloseTo(2800);
    expect(rows[0].durationS).not.toBe(stravaStreamEfforts(run(10, 300))[0].durationS);
  });
  it('qualifies continuous Strava sections without stitching across an unknown pause boundary', () => {
    const first = run(5, 300), second = run(5, 280);
    const time = [...first.time.data, ...second.time.data.map(t => t + 2000)];
    const distance = [...first.distance.data, ...second.distance.data.map(d => d + 5005)];
    const moving = time.map(() => true); moving[first.time.data.length] = false;
    const rows = stravaStreamEfforts(streams(time, distance, moving));
    expect(rows[0]).toMatchObject({ status: 'calculated', reason: 'partial_stream_coverage', durationS: 1400, sourceDistanceM: 10005, coverageDistanceM: 5000, startOffsetS: 2000, endOffsetS: 3400 });
    expect(rows[1]).toMatchObject({ status: 'unavailable', reason: 'unknown_recording_gap', durationS: null });
    // Even an implausibly fast final section cannot be accepted after a gap.
    distance[distance.length - 1] += 100;
    expect(stravaStreamEfforts(streams(time, distance, moving))[0].reason).toBe('implausible_distance_jump');
  });
  it('excludes stopped distance for both providers without shortening active running time', () => {
    const source = run(10); const at = 250;
    for (const drift of [0.7, 100]) {
      const time = [...source.time.data.slice(0, at + 1), 780, 900, ...source.time.data.slice(at + 1).map(t => t + 150)];
      const distance = [...source.distance.data.slice(0, at + 1), 2500, 2500 + drift, ...source.distance.data.slice(at + 1).map(d => d + drift)];
      const moving = [...source.moving.data.slice(0, at + 1), false, false, ...source.moving.data.slice(at + 1)];
      const strava = stravaStreamEfforts(streams(time, distance, moving));
      expect(strava[1]).toMatchObject({ status: 'calculated', durationS: 3030, coverageDistanceM: 10000, sourceDistanceM: 10000 + drift, endOffsetS: 3150 });
      const garmin = garminFitEfforts(fit(time, distance, [[0, 'start'], [780, 'stop'], [900, 'start'], [3150, 'stop_all']]));
      expect(garmin[1]).toMatchObject({ status: 'calculated', durationS: 3030, coverageDistanceM: 10000, sourceDistanceM: 10000 + drift, endOffsetS: 3150 });
      // The earliest fastest 5 km is wholly after the pause; offsets stay elapsed.
      for (const rows of [strava, garmin]) expect(rows[0]).toMatchObject({ durationS: 1500, startOffsetS: 900, endOffsetS: 2400 });
    }
  });
  it('does not qualify a target using paused distance or conceal a raw distance reset', () => {
    const source = run(5); const at = 250;
    const time = [...source.time.data.slice(0, at + 1), 750, 1350, ...source.time.data.slice(at + 1).map(t => t + 600)];
    // Stop begins at the first record and raw distance advances during the pause.
    time[at + 1] = 753;
    const distance = [...source.distance.data.slice(0, at + 1), 2500, 2501, ...source.distance.data.slice(at + 1)];
    const moving = [...source.moving.data.slice(0, at + 1), false, false, ...source.moving.data.slice(at + 1)];
    const messages = () => fit(time, distance, [[0, 'start'], [753, 'stop'], [1350, 'start'], [2100, 'stop_all']]);
    for (const rows of [stravaStreamEfforts(streams(time, distance, moving)), garminFitEfforts(messages())]) {
      expect(rows[0]).toMatchObject({ status: 'unavailable', reason: 'too_short', sourceDistanceM: 5000, coverageDistanceM: 4999, pauseCoverage: 'validated' });
    }
    distance[at + 2] = 2499;
    for (const rows of [stravaStreamEfforts(streams(time, distance, moving)), garminFitEfforts(messages())]) expect(rows[0].reason).toBe('distance_reset');
    expect(stravaStreamEfforts(streams([0, 600], [0, 100], [false, false]))[0]).toMatchObject({ reason: 'too_short', coverageDistanceM: 0 });
  });
  it('excludes Garmin timer stops/resumes including stop-disable event types', () => {
    const source = run(5); const at = 250;
    const time = [...source.time.data.slice(0, at + 1), 1350, ...source.time.data.slice(at + 1).map(t => t + 600)];
    const distance = [...source.distance.data.slice(0, at + 1), 2500, ...source.distance.data.slice(at + 1)];
    for (const stop of ['stop', 'stop_all', 'stop_disable', 'stop_disable_all']) {
      expect(garminFitEfforts(fit(time, distance, [[0, 'start'], [750, stop], [1350, 'start'], [2100, 'stop_all']]))[0]).toMatchObject({ durationS: 1500, endOffsetS: 2100 });
    }
  });
  it('fails closed for absent/ambiguous FIT timers, timer transitions across distance, gaps and bad fields', () => {
    const source = run(5); const t = source.time.data, d = source.distance.data;
    expect(garminFitEfforts(fit(t, d, []))[0].reason).toBe('insufficient_pause_evidence');
    expect(garminFitEfforts(fit(t, d, [[3, 'start'], [1500, 'stop_all']]))[0].reason).toBe('insufficient_pause_evidence');
    expect(garminFitEfforts(fit(t, d, [[0, 'start'], [1, 'stop'], [2, 'start'], [1500, 'stop_all']]))[0].reason).toBe('distance_during_pause_or_transition');
    expect(garminFitEfforts(fit(t, d, [[0, 'start'], [1, 'start'], [1500, 'stop_all']]))[0].reason).toBe('inconsistent_timer_events');
    expect(garminFitEfforts(fit([0, 100], [0, 100]))[0].reason).toBe('unknown_recording_gap');
    const messages = fit(t, d); messages.at(-1)!.fields[1].units = 'km';
    expect(garminFitEfforts(messages)[0].reason).toBe('missing_or_invalid_fit_distance');
  });
});
