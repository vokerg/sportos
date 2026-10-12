import { describe, expect, it } from 'vitest';
import type { ActivityMetricComparison } from './activity-metrics.models';
import { detailMetricGroups, highlightMetrics, comparisonGroups, effectivelyEqual, formatMetric, supplementalMetricGroups } from './activity-metrics.view-model';
function metric(key = 'distance', unit = 'm', a = 10000, b = 10005): ActivityMetricComparison {
  return { key, unit, label: key, selected: { value: a, source: 'strava', reason: 'canonical_authority' }, candidates: [
    { provider: 'garmin', value: b, selectedWithinProvider: true, sourceKind: 'fit_session', sourceField: 'test', sourceUnit: unit, origin: 'recorded', projectionId: 'version', projectedAt: '2026-01-01' },
    { provider: 'strava', value: a, selectedWithinProvider: true, sourceKind: 'compact', sourceField: 'test', sourceUnit: unit, origin: 'provider_derived', projectionId: 'version', projectedAt: '2026-01-01' },
  ] };
}
const values = (m: ActivityMetricComparison, sport = 'run') => comparisonGroups([m], sport)[0].items[0].values;
describe('activity metrics display', () => {
  it('presents run average and maximum speeds as independent provider paces, keeping cycling speed', () => {
    const metrics = [metric('average_speed', 'm/s', 12.8 / 3.6, 12.6 / 3.6), metric('maximum_speed', 'm/s', 16.9 / 3.6, 16.4 / 3.6)];
    const before = JSON.stringify(metrics), rows = comparisonGroups(metrics, 'run')[0].items;
    expect(rows.map(r => [r.key, r.label, r.values.map(v => v.text)])).toEqual([
      ['average_pace', 'Average pace', ['4:41 /km', '4:46 /km']],
      ['maximum_pace', 'Fastest pace', ['3:33 /km', '3:40 /km']],
    ]);
    expect(rows[0].values.map(v => [v.sources, v.authoritative])).toEqual([[['Strava'], true], [['Garmin'], false]]);
    expect(comparisonGroups(metrics, 'bike')[0].items.map(r => r.values.map(v => v.text))).toEqual([['12.8 km/h', '12.6 km/h'], ['16.9 km/h', '16.4 km/h']]);
    expect(JSON.stringify(metrics)).toBe(before);
  });
  it('merges native running pace and speed conversion once, filling only missing providers', () => {
    const native = metric('average_pace', 's/km', 280, 281); native.label = 'Moving pace'; native.candidates = [native.candidates[1]];
    const speed = metric('average_speed', 'm/s', 3.4, 3.5);
    const rows = comparisonGroups([native, speed], 'run')[0].items;
    expect(rows).toHaveLength(1); expect(rows[0].label).toBe('Moving pace');
    expect(rows[0].values.map(v => v.text)).toEqual(['4:40 /km', '4:46 /km']);
    expect(values(metric('average_speed', 'm/s', 0, 0))).toEqual([]);
    expect(formatMetric(0, 'maximum_speed', 'm/s', 'run')).toBe('Unavailable');
  });
  it.each([
    [65.4, 'elapsed_duration','s','run','1:05'], [3661,'moving_duration','s','run','1:01:01'],
    [299.8,'average_pace','s/km','run','5:00 /km'], [1199,'average_pace','s/km','swim','2:00 /100m'],
    [10,'average_speed','m/s','bike','36.0 km/h'], [10020,'distance','m','run','10 km'],
    [1500,'distance','m','swim','1,500 m'], [999,'distance','m','run','999 m'],
    [123.4,'ascent','m','run','123 m'], [152.6,'average_heart_rate','bpm','run','153 bpm'],
    [255.7,'average_power','W','run','256 W'], [1.234,'step_length','m','run','1.23 m'], [25.5,'pool_length','m','swim','25.50 m'],
    [48.24,'ground_contact_balance','%','run','48.2 %'], [8.24,'vertical_oscillation','mm','run','8.2 mm'],
    [3.14,'aerobic_training_effect','TE','run','3.1 TE'], [-2.3,'average_temperature','C','run','-2.3 °C'],
    [0,'calories','kcal','run','0 kcal'],
  ])('formats %s %s for %s', (value, key, unit, sport, expected) => {
    expect(formatMetric(value as number, key as string, unit as string, sport as string)).toBe(expected);
  });
  it.each([['distance',10],['elapsed_duration',1],['average_pace',1],['average_heart_rate',1],['average_speed',0.1/3.6],['ground_contact_balance',0.1],['running_cadence',1],['average_power',1]])('handles inclusive %s tolerance', (key, tolerance) => {
    expect(effectivelyEqual(key as string, 100, 100 + Number(tolerance), 'run')).toBe(true);
    expect(effectivelyEqual(key as string, 100, 100 + Number(tolerance) + 0.0001, 'run')).toBe(false);
  });
  it('compares swim pace in seconds per 100m and counts exactly', () => {
    expect(effectivelyEqual('average_pace',1200,1210,'swim')).toBe(true);
    expect(effectivelyEqual('average_pace',1200,1210.01,'swim')).toBe(false);
    expect(effectivelyEqual('strength_workingSets',3,4,'workout')).toBe(false);
    expect(effectivelyEqual('unknown',1,1.01,'run')).toBe(false);
  });
  it('collapses equal providers once and preserves exact authority', () => {
    const rows = values(metric());
    expect(rows).toEqual([{value:10000,text:'10 km',sources:['Strava','Garmin'],authoritative:true,fallback:false}]);
  });
  it('does not collapse disagreeing providers through an intermediate canonical value', () => {
    const m = metric('distance','m',10010,9990); m.selected!.value = 10000;
    expect(values(m)).toHaveLength(2);
  });
  it('keeps meaningful differences in Strava/Garmin order even with Garmin authority', () => {
    const m = metric('average_power','W',200,210); m.selected = {value:210,source:'garmin',reason:'provider_priority'};
    expect(values(m).map(v => [v.sources, v.authoritative])).toEqual([[['Strava'],false],[['Garmin'],true]]);
  });
  it('preserves manual authority when provider values disagree', () => {
    const m = metric(); m.selected = {value:11000,source:'manual',reason:'canonical_authority'};
    expect(values(m).map(v => [v.sources,v.authoritative])).toEqual([[['Strava','Garmin'],false],[['Manual'],true]]);
  });
  it('does not hide corrected canonical values behind a same-provider observation', () => {
    const m = metric(); m.selected!.value = 11000;
    expect(values(m)).toHaveLength(2);
    expect(values(m).find(v => v.authoritative)?.value).toBe(11000);
  });
  it('uses valid Garmin as read-only fallback without mutation or promoting Strava', () => {
    const m = metric(); m.selected = null; const before = JSON.stringify(m);
    expect(values(m)[0]).toMatchObject({sources:['Strava','Garmin'],value:10005,authoritative:false,fallback:true});
    expect(JSON.stringify(m)).toBe(before);
    m.candidates[0].value = NaN;
    expect(values(m)[0]).toMatchObject({sources:['Strava'],authoritative:false,fallback:false});
    m.candidates[1].value = -1; expect(values(m)).toEqual([]);
  });
  it('shows both providers when a Garmin fallback differs, keeping Strava first', () => {
    const m = metric('distance','m',10000,11000); m.selected = null;
    expect(values(m).map(v => [v.sources,v.fallback,v.authoritative])).toEqual([[['Strava'],false,false],[['Garmin'],true,false]]);
  });
  it('retains recorded zero and excludes alternatives and nonfinite selections', () => {
    const m = metric('calories','kcal',0,0); m.selected!.value = Infinity;
    m.candidates.push({...m.candidates[0],value:999,selectedWithinProvider:false});
    expect(values(m)[0]).toMatchObject({value:0,fallback:true});
  });
  it('combines Strava run cycles with already normalized Garmin running steps once', () => {
    const general = metric('average_cadence','rpm',88,90);
    general.selected!.reason = 'provider_priority';
    const explicit = metric('running_cadence','steps/min',176,176); explicit.candidates = [explicit.candidates[0]];
    explicit.selected = {value:176,source:'garmin',reason:'provider_priority'};
    const before = JSON.stringify([general, explicit]);
    const rows = comparisonGroups([general,explicit], 'run')[0].items;
    expect(rows).toHaveLength(1); expect(rows[0].values[0]).toMatchObject({text:'176 steps/min',sources:['Strava','Garmin']});
    expect(JSON.stringify([general,explicit])).toBe(before);
  });
  it('normalizes general Garmin running cycles only, and keeps cycling rpm separate', () => {
    expect(values(metric('average_cadence','rpm',88,88))[0].text).toBe('176 steps/min');
    const bike = comparisonGroups([metric('average_cadence','rpm',88,88)], 'bike');
    expect(bike[0]).toMatchObject({title:'Other',items:[{label:'Average cycling cadence',values:[{text:'88 rpm'}]}]});
    expect(values(metric('running_cadence','steps/min',176,176))[0].text).toBe('176 steps/min');
  });
  it('never doubles cycling maximum cadence or explicit maximum running cadence', () => {
    expect(values(metric('maximum_cadence','rpm',90,90), 'bike')[0].text).toBe('90 rpm');
    expect(values(metric('maximum_running_cadence','steps/min',190,190))[0].text).toBe('190 steps/min');
  });
  it('groups all five sections in order', () => {
    const keys = ['swolf','average_power','running_cadence','average_heart_rate','distance'];
    expect(comparisonGroups(keys.map(k => metric(k)), 'run').map(g => g.title)).toEqual(['Time & Distance','Heart Rate','Running Dynamics','Power & Training','Other']);
  });
  it('removes duplicate canonical cards while preserving steps, effort and stopped time', () => {
    const activity = { activity_type:'run', source:'strava', distance_m:10000, duration_s:3600, moving_time_s:3500, avg_pace_s_per_km:null, avg_speed_mps:null, avg_hr:null, max_hr:null, elevation_gain_m:null, calories:null, steps:10000, effort_points:3, metricComparisons:[metric(),metric('elapsed_duration','s',3600,3600)] };
    const labels = supplementalMetricGroups(activity as never).flatMap(g => g.items.map(m => m.label));
    expect(labels).not.toContain('Distance'); expect(labels).not.toContain('Elapsed time');
    expect(labels).toEqual(['Moving time','Stopped time','Steps','Effort points']);
    expect(supplementalMetricGroups({...activity,metricComparisons:[]} as never).flatMap(g => g.items).map(m => m.label)).toContain('Distance');
  });
});

const canonical = { activity_type: 'run', source: 'strava', distance_m: 12567,
  duration_s: 3900, moving_time_s: 3600, avg_pace_s_per_km: 287, avg_speed_mps: 3.5,
  avg_hr: 140, max_hr: 165, elevation_gain_m: 120, calories: 800, steps: 10000, effort_points: 3 };

it.each([
  ['run', ['distance', 'average_pace', 'moving_duration']],
  ['bike', ['distance', 'average_speed', 'moving_duration']],
  ['swim', ['distance', 'average_pace', 'elapsed_duration']],
])('prioritizes %s without stopped time or invented metrics', (sport, keys) => {
  const activity = { ...canonical, activity_type: sport } as never;
  const groups = detailMetricGroups(activity);
  expect(highlightMetrics(groups, sport).map(m => m.key)).toEqual(keys);
  expect(groups.flatMap(g => g.items).find(m => m.key === 'stopped_duration')?.values[0].text).toBe('5:00');
});
it('keeps provider authority, differences and exact numbers when highlights round distance', () => {
  const m = metric('distance', 'm', 12567, 12500);
  const activity = { ...canonical, metricComparisons: [m] } as never;
  const before = JSON.stringify(activity);
  const highlights = highlightMetrics(detailMetricGroups(activity), 'run');
  expect(highlights[0].values.map(v => [v.text, v.value, v.authoritative])).toEqual([
    ['12.6 km', 12567, true], ['12.5 km', 12500, false],
  ]);
  expect(JSON.stringify(activity)).toBe(before);
});
it('falls back to elapsed time and omits missing pace without deriving a new value', () => {
  const activity = { ...canonical, moving_time_s: null, avg_pace_s_per_km: null } as never;
  expect(highlightMetrics(detailMetricGroups(activity), 'run').map(m => m.key)).toEqual(['distance', 'elapsed_duration']);
});
it('preserves read-only Garmin fallback in the highlights', () => {
  const m = metric(); m.selected = null; m.candidates = [m.candidates[0]];
  expect(highlightMetrics(detailMetricGroups({ ...canonical, metricComparisons: [m] } as never), 'run')[0].values[0])
    .toMatchObject({ fallback: true, authoritative: false, sources: ['Garmin'] });
});
