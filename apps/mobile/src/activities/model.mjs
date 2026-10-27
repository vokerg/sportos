import { formatDistance, formatDuration, formatPace, isCalendarDate, shiftCalendarDate } from '../ui/format.mjs';

/** UI-only projections. Raw provider JSON, owner IDs and source payloads never enter component state. */
const TYPES = ['steps','walk','run','bike','swim','workout','rowing','sup','hiit','bonus'];
const SOURCES = ['manual','my_sport_xlsx','run_db_xlsx','google_sheets','strava','garmin','fit'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = ['not_linked','linked_unprocessed','linked_no_rich_data','raw_retained_unprocessed','processed','partial','failed','stale'];
const EFFORT_STATES = ['current','unprocessed','stale','failed','not_linked'];
const METHODS = ['summary_estimate','stream_calculated','fit_calculated'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new Error('Invalid SportOS activity response'); };
const required = (value, max = 160) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
};
const optional = (value, max = 160) => value == null ? null : required(value, max);
const num = (value, min = 0, max = 1e12) => {
  const n = typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) invalid();
  return n;
};
const nullable = (value, min = 0, max = 1e12) => value == null ? null : num(value,min,max);
const list = (value, max) => {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
};
const enumValue = (value, allowed) => allowed.includes(value) ? value : invalid();
const date = value => isCalendarDate(value) ? value : invalid();
export const validActivityId = value => typeof value === 'string' && UUID.test(value);
export const activityDetailPath = id => {
  if (!validActivityId(id)) throw new Error('Invalid activity ID');
  return '/activities/' + id;
};
export function activityListPath({ range = '90d', type = 'all', source = 'all', offset = 0, limit = 25, today } = {}) {
  if (!['30d','90d','all'].includes(range) || (type !== 'all' && !TYPES.includes(type))
    || (source !== 'all' && !SOURCES.includes(source)) || !Number.isInteger(offset)
    || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid activity filter');
  const parts = [];
  if (range !== 'all') {
    if (!isCalendarDate(today)) throw new Error('Invalid activity date');
    parts.push('from=' + shiftCalendarDate(today, range === '30d' ? -29 : -89), 'to=' + today);
  }
  if (type !== 'all') parts.push('activityType=' + type);
  if (source !== 'all') parts.push('source=' + source);
  return '/activities?' + [...parts, 'limit=' + limit, 'offset=' + offset].join('&');
}
function coverage(value) {
  if (value == null) return [];
  return list(value, 2).map(raw => {
    if (!object(raw)) invalid();
    return {
      provider: enumValue(raw.provider, ['strava','garmin']),
      linked: raw.linked === true,
      rawRetained: raw.rawRetained === true ? true : raw.rawRetained === false ? false : null,
      state: enumValue(raw.state, STATES),
      compactOnly: raw.compactOnly === true,
    };
  });
}
export function providerLabel(row) {
  const level = row.rawRetained === true ? 'retained detail' : row.rawRetained === false ? 'summary only' : 'retention unknown';
  const state = ({not_linked:'not linked',linked_unprocessed:'pending metrics',linked_no_rich_data:'no rich detail',
    raw_retained_unprocessed:'pending normalization',processed:'normalized',partial:'partial metrics',
    failed:'normalization failed',stale:'stale metrics'})[row.state] ?? 'unknown';
  return (row.provider === 'strava' ? 'Strava' : 'Garmin') + ': ' + (row.linked ? state + ' · ' + level : 'not linked');
}
const activity = raw => {
  if (!object(raw) || !validActivityId(raw.id)) invalid();
  const type = enumValue(raw.activity_type, TYPES);
  const source = enumValue(raw.source, SOURCES);
  return {
    id: raw.id, activity_date: date(raw.activity_date), start_time: optional(raw.start_time, 64),
    activity_type: type, subtype: optional(raw.subtype, 40), source,
    distance_m: nullable(raw.distance_m, 0, 1e8),
    duration_s: nullable(raw.duration_s, 0, 604800),
    moving_time_s: nullable(raw.moving_time_s, 0, 604800),
    avg_hr: nullable(raw.avg_hr, 0, 300), max_hr: nullable(raw.max_hr, 0, 300),
    steps: nullable(raw.steps, 0, 1e7), calories: nullable(raw.calories, 0, 1e7),
    elevation_gain_m: nullable(raw.elevation_gain_m, -100000, 100000),
    avg_speed_mps: nullable(raw.avg_speed_mps, 0, 100),
    avg_pace_s_per_km: nullable(raw.avg_pace_s_per_km, 0, 360000),
    historicalSummary: raw.historicalSummary === true,
    providerMetrics: coverage(raw.providerMetrics),
    distanceCorrection: !raw.distanceCorrection ? null : (() => {
      if (!object(raw.distanceCorrection)) invalid();
      return {
        effectiveDistanceM: num(raw.distanceCorrection.effectiveDistanceM),
        recordedDistanceM: num(raw.distanceCorrection.recordedDistanceM),
        revision: num(raw.distanceCorrection.revision,0,1e6),
      };
    })(),
  };
};
export function projectActivityList(payload) {
  if (!object(payload) || !object(payload.summary)) invalid();
  const count = num(payload.summary.count,0,1e8);
  if (!Number.isSafeInteger(count)) invalid();
  const limit = num(payload.limit,1,100), offset = num(payload.offset,0,100000);
  if (!Number.isInteger(limit) || !Number.isInteger(offset)) invalid();
  const items = list(payload.items,100).map(activity);
  if (items.length > limit || offset + items.length > count) invalid();
  return { items, count, limit, offset };
}
const efforts = value => {
  if (value == null) return [];
  if (!object(value)) invalid();
  return list(value.providers, 4).map(raw => {
    if (!object(raw)) invalid();
    const provider = enumValue(raw.provider,['strava','garmin']);
    const state = enumValue(raw.state,EFFORT_STATES);
    return {
      provider, state,
      efforts: list(raw.efforts,20).map(item => {
        if (!object(item)) invalid();
        return {
          targetDistanceM: num(item.targetDistanceM,1,100000),
          method: enumValue(item.method,METHODS),
          status: enumValue(item.status,['estimated','calculated','unavailable']),
          durationS: nullable(item.durationS,0,604800),
        };
      }),
    };
  });
};
const comparisons = value => {
  if (value == null) return [];
  return list(value,100).map(raw => {
    if (!object(raw)) invalid();
    if (raw.selected == null) return null;
    if (!object(raw.selected)) invalid();
    return {
      key: required(raw.key,80), label: required(raw.label,100), unit: required(raw.unit,32),
      value: num(raw.selected.value,-1e8,1e8), source: required(raw.selected.source,120),
    };
  }).filter(Boolean);
};
function strength(value) {
  if (value == null) return null;
  if (!object(value)) invalid();
  return {
    workingSets: num(value.workingSets,0,1e5), totalRecordedSets: num(value.totalRecordedSets,0,1e5),
    warmupSets: num(value.warmupSets,0,1e5), restMarkers: num(value.restMarkers,0,1e5),
    complete: value.complete === true,
    exercises: list(value.exercises,100).map(row => {
      if (!object(row)) invalid();
      return { name: required(row.name,120), workingSets: num(row.workingSets,0,1e5) };
    }),
  };
}
export function projectActivityDetail(payload) {
  const base = activity(payload);
  if (!object(payload)) invalid();
  return {
    ...base, bestEfforts: efforts(payload.bestEfforts),
    metricComparisons: comparisons(payload.metricComparisons),
    garminStrength: strength(payload.garminStrength),
    linkedStrava: base.providerMetrics.some(p => p.provider === 'strava' && p.linked) || payload.providerDetail?.provider === 'strava',
    linkedGarmin: base.providerMetrics.some(p => p.provider === 'garmin' && p.linked) || payload.garmin?.provider === 'garmin',
    provenance: payload.provenance && object(payload.provenance)
      ? optional(payload.provenance.sourceRecordSource,80) : null,
    // Original notes can carry personal/location data; render a bounded activity name only.
    name: base.source === 'strava' ? optional(payload.notes,120) : null,
  };
}
export function projectEnrichment(raw) {
  if (!object(raw) || !object(raw.strava) || !object(raw.garmin)) invalid();
  return {
    strava: enumValue(raw.strava.state,['cached','missing','stale','unavailable']),
    garmin: enumValue(raw.garmin.state,['cached','linked','missing']),
    garminFetchEnabled: raw.garmin.fetchEnabled === true,
  };
}
export function projectSwimLengths(raw) {
  if (!object(raw)) invalid();
  const status = enumValue(raw.status,['available','unavailable']);
  if (status === 'unavailable') return { status, reason: optional(raw.reason,80), lengths: [] };
  const lengths = list(raw.lengths,2000).map(row => {
    if (!object(row)) invalid();
    return {
      row: num(row.row,1,2000), lengthNumber: nullable(row.lengthNumber,0,2000),
      kind: enumValue(row.kind,['active','rest','unknown']),
      durationS: nullable(row.durationS,0,604800), durationBasis: row.durationBasis == null ? null : enumValue(row.durationBasis,['timer','elapsed']),
      paceSPer100M: nullable(row.paceSPer100M,0,360000),
      strokes: nullable(row.strokes,0,10000), swolf: nullable(row.swolf,0,10000),
      stroke: optional(row.stroke,80),
    };
  });
  return { status, lengths, poolLengthM: nullable(raw.poolLengthM,1,200),
    complete: raw.complete === true ? true : raw.complete === false ? false : null,
    truncated: raw.truncated === true,
    expectedLengths: nullable(raw.expectedLengths,0,10000),
    recordedDistanceM: nullable(raw.recordedDistanceM),
    effectiveDistanceM: nullable(raw.effectiveDistanceM),
    effectiveActiveLengths: nullable(raw.effectiveActiveLengths,0,10000) };
}
function fitFields(lap) {
  const map = new Map(), seen = new Set();
  if (!object(lap) || lap.message !== 'lap' || !Array.isArray(lap.fields)) return null;
  for (const field of lap.fields.slice(0,150)) {
    if (!object(field) || typeof field.name !== 'string' || field.developerIndex != null) continue;
    if (seen.has(field.name)) { map.delete(field.name); continue; }
    seen.add(field.name);
    map.set(field.name,field);
  }
  return map;
}
function splitNum(value, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}
export function projectLaps(raw, source) {
  if (source !== 'strava' && source !== 'garmin') throw new Error('Unknown lap provider');
  let laps;
  if (source === 'strava') {
    if (!object(raw) || !object(raw.resources)) invalid();
    const resource = raw.resources.laps;
    laps = resource?.availability === 'available' ? resource.payload : [];
  } else {
    if (!object(raw)) invalid();
    laps = raw.laps;
  }
  const bounded = list(laps,source === 'strava' ? 10000 : 200);
  const cap = source === 'strava' ? 1000 : 100;
  const rows = [];
  for (const [index, lap] of bounded.slice(0,cap).entries()) {
    if (!object(lap)) continue;
    const fit = source === 'garmin' ? fitFields(lap) : null;
    if (source === 'garmin' && !fit) continue;
    const get = (key, unit, max) => source === 'strava'
      ? splitNum(lap[key],max)
      : fit.get(key)?.units === unit ? splitNum(fit.get(key).value,max) : null;
    const distanceM = get(source === 'strava'?'distance':'total_distance','m',1e6);
    const moving = get(source === 'strava'?'moving_time':'total_timer_time','s',604800);
    const elapsed = get(source === 'strava'?'elapsed_time':'total_elapsed_time','s',604800);
    const durationS = moving ?? elapsed;
    const heartRate = get(source === 'strava'?'average_heartrate':'avg_heart_rate','bpm',300);
    rows.push({ row: index+1, distanceM, durationS,
      basis: moving !== null ? source === 'strava' ? 'moving' : 'timer' : elapsed !== null ? 'elapsed' : null,
      paceSPerKm: distanceM > 0 && durationS > 0 ? durationS*1000/distanceM : null,
      heartRate: heartRate > 0 ? heartRate : null });
  }
  return { rows, truncated: bounded.length > cap };
}
export function projectGarminSets(raw) {
  if (!object(raw)) invalid();
  const payload = Array.isArray(raw.sets) ? raw.sets : object(raw.sets) ? raw.sets.exerciseSets : null;
  if (!Array.isArray(payload)) return [];
  return payload.slice(0,100).filter(object).map(item =>
    Object.entries(item).filter(([key,val]) => /^[A-Za-z_]{1,50}$/.test(key)
      && (typeof val === 'string' || typeof val === 'number') && String(val).length <= 100)
      .slice(0,8).map(([name,val]) => ({ label: name.replaceAll('_',' '), value: String(val) }))).filter(row => row.length);
}
export const title = type => ({
  run:'Run',walk:'Walk',bike:'Ride',swim:'Swim',workout:'Workout',steps:'Steps',
  rowing:'Rowing',sup:'Paddling',hiit:'HIIT',bonus:'Bonus',
})[type] ?? 'Activity';
export function activityDistance(row) {
  return row.distance_m === null ? '—' : row.activity_type === 'swim'
    ? Math.round(row.distance_m).toLocaleString('en-US') + ' m' : formatDistance(row.distance_m);
}
export function summaryMetrics(row) {
  const output = [];
  const put = (label,value,show) => { if (value !== null && Number.isFinite(value)) output.push({label,value:show(value)}); };
  if (['run','swim','bike','walk','rowing','sup'].includes(row.activity_type)) put('Distance',row.distance_m,n => row.activity_type === 'swim' ? Math.round(n)+' m' : formatDistance(n));
  put(row.source === 'strava' ? 'Elapsed time' : 'Duration',row.duration_s,formatDuration);
  if (row.moving_time_s !== null && row.moving_time_s !== row.duration_s) put('Moving time',row.moving_time_s,formatDuration);
  if (row.activity_type === 'run' || row.activity_type === 'walk') put('Pace',row.avg_pace_s_per_km,formatPace);
  if (row.activity_type === 'swim') put('Pace',row.avg_pace_s_per_km,n => formatDuration(n/10) + ' /100 m');
  if (['bike','rowing','sup'].includes(row.activity_type)) put('Average speed',row.avg_speed_mps,n => (n*3.6).toFixed(1) + ' km/h');
  if (row.activity_type !== 'steps' && row.activity_type !== 'bonus') {
    put('Average HR',row.avg_hr,n => Math.round(n)+' bpm');
    put('Max HR',row.max_hr,n => Math.round(n)+' bpm');
  }
  put('Ascent',row.elevation_gain_m,n => Math.round(n)+' m');
  put('Calories',row.calories,n => Math.round(n)+' kcal');
  if (row.activity_type === 'steps' || row.activity_type === 'walk') put('Steps',row.steps,n => Math.round(n).toLocaleString('en-US'));
  return output;
}
export function effortRows(providers) {
  return providers.flatMap(p => p.state === 'current' ? p.efforts.filter(e =>
    e.status !== 'unavailable' && e.durationS !== null && e.durationS > 0)
    .map(e => ({provider:p.provider,method:e.method,status:e.status,
      distanceM:e.targetDistanceM,durationS:e.durationS})) : []);
}
