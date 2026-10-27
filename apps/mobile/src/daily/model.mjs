/** Read-only presentation helpers. All points and classifications originate in SportOS API responses. */
import { isCalendarDate } from '../ui/format.mjs';

const categories = {
  steps: 'Steps', run: 'Running', bike: 'Cycling', swim: 'Swimming',
  workout: 'Workout', rowing: 'Rowing', sup: 'SUP', hiit: 'HIIT',
  bonus: 'Bonus', unattributed: 'Unattributed',
};
export function dailySummaryPath(options = {}) {
  const params = [];
  if (options.from !== undefined) {
    if (!isCalendarDate(options.from)) throw new Error('Invalid from date');
    params.push('from=' + options.from);
  }
  if (options.to !== undefined) {
    if (!isCalendarDate(options.to)) throw new Error('Invalid to date');
    params.push('to=' + options.to);
  }
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10000)
      throw new Error('Invalid limit');
    params.push('limit=' + options.limit);
  }
  return '/daily/summary' + (params.length ? '?' + params.join('&') : '');
}
export function scoreBreakdownPath(date) {
  if (!isCalendarDate(date)) throw new Error('Invalid score date');
  return '/daily/' + date + '/score-breakdown';
}
export function formatPoints(value, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const text = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  return signed && value > 0 ? '+' + text : text;
}
export function scoreAuthority(value) {
  return value === 'imported' ? 'Imported score'
    : value === 'manual' ? 'Manual edit'
    : value === 'calculated' ? 'Calculated score' : 'Unknown authority';
}
export function contributionRows(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return Object.entries(categories)
    .filter(([key]) => typeof values[key] === 'number' && Number.isFinite(values[key]))
    .map(([key, label]) => ({ key, label, points: values[key] }));
}
export function mergeDays(existing, older) {
  const map = new Map();
  for (const row of [...existing, ...older]) {
    if (row && isCalendarDate(row.metric_date) && !map.has(row.metric_date)) map.set(row.metric_date, row);
  }
  return [...map.values()].sort((a, b) => b.metric_date.localeCompare(a.metric_date));
}
export function todayCoverage(date, today) {
  return date === today ? 'Today is incomplete — provider updates and recalculation may be pending.'
    : date < today ? 'Latest persisted record; newer days may have no score yet.'
    : 'Future date — no persisted score expected.';
}
export function sourceNames(sources) {
  if (!sources) return 'Provider coverage not reported';
  const names = [];
  if (sources.strava) names.push('Strava');
  if (sources.garmin) names.push('Garmin');
  return names.length ? 'Evidence: ' + names.join(' + ') : 'No linked provider evidence reported';
}
export function safeActivityType(value) {
  const names = { steps: 'Steps', walk: 'Walk', run: 'Run', bike: 'Ride',
    swim: 'Swim', workout: 'Workout', rowing: 'Rowing', sup: 'SUP',
    hiit: 'HIIT', bonus: 'Bonus' };
  return names[value] ?? 'Activity';
}


/** Safely normalize bounded API responses; no owner/source/raw-payload fields survive. */
const scoreStates = new Set(['imported', 'manual', 'calculated']);
const contributionNames = Object.keys(categories);
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalidResponse() {
  throw new Error('Invalid SportOS daily response');
}
function number(value) {
  // The Postgres numeric JSON codec can emit decimal text in some environments.
  const candidate = typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)
    ? Number(value) : value;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) invalidResponse();
  return candidate;
}
function nullableNumber(value) {
  return value === null ? null : number(value);
}
function literal(value) {
  if (typeof value !== 'string' || value.length > 200) invalidResponse();
  return value;
}
function day(value) {
  if (!isCalendarDate(value)) invalidResponse();
  return value;
}
function scoreState(value) {
  if (!scoreStates.has(value)) invalidResponse();
  return value;
}
function boundedArray(value, max) {
  if (!Array.isArray(value) || value.length > max) invalidResponse();
  return value;
}
export function parseDailySummaries(payload) {
  return boundedArray(payload, 100).map(raw => {
    if (!object(raw)) invalidResponse();
    let score_contributions;
    if (raw.score_contributions !== undefined && raw.score_contributions !== null) {
      if (!object(raw.score_contributions)) invalidResponse();
      score_contributions = {};
      for (const key of contributionNames) {
        if (raw.score_contributions[key] !== undefined) {
          score_contributions[key] = number(raw.score_contributions[key]);
        }
      }
    }
    let providerSources;
    if (raw.providerSources !== undefined && raw.providerSources !== null) {
      if (!object(raw.providerSources)
        || typeof raw.providerSources.strava !== 'boolean'
        || typeof raw.providerSources.garmin !== 'boolean') invalidResponse();
      providerSources = {
        strava: raw.providerSources.strava,
        garmin: raw.providerSources.garmin,
      };
    }
    return {
      metric_date: day(raw.metric_date), score_status: scoreState(raw.score_status),
      total_points: number(raw.total_points),
      base_points: number(raw.base_points), bonus_points: number(raw.bonus_points),
      steps: number(raw.steps), run_m: number(raw.run_m), bike_m: number(raw.bike_m),
      swim_m: number(raw.swim_m), workout_points: number(raw.workout_points),
      excel_all_points: nullableNumber(raw.excel_all_points ?? null),
      points_delta_vs_excel: nullableNumber(raw.points_delta_vs_excel ?? null),
      avg_30d: nullableNumber(raw.avg_30d ?? null),
      ...(score_contributions ? { score_contributions } : {}),
      ...(providerSources ? { providerSources } : {}),
    };
  });
}
export function projectActivityPreview(payload) {
  if (!object(payload) || !object(payload.summary)) invalidResponse();
  const count = number(payload.summary.count);
  if (!Number.isSafeInteger(count) || count < 0) invalidResponse();
  return {
    summary: { count },
    items: boundedArray(payload.items, 5).map(raw => {
      if (!object(raw)) invalidResponse();
      return {
        id: literal(raw.id), activity_date: day(raw.activity_date),
        activity_type: literal(raw.activity_type), source: literal(raw.source),
        distance_m: nullableNumber(raw.distance_m),
        duration_s: nullableNumber(raw.duration_s),
      };
    }),
  };
}

/** Whitelist the only daily-detail fields allowed in native component state. */
export function projectDetail(raw) {
  if (!object(raw) || !object(raw.score) || !object(raw.facts)) invalidResponse();
  const ledger = boundedArray(raw.ledger, 1000);
  const activities = boundedArray(raw.activities, 1000);
  const result = {
    date: day(raw.date),
    recomputedAt: literal(raw.recomputedAt),
    status: scoreState(raw.scoreStatus),
    score: {
      appTotal: number(raw.score.appTotal),
      baseTotal: number(raw.score.baseTotal),
      bonusPoints: number(raw.score.bonusPoints),
      ledgerTotal: number(raw.score.ledgerTotal),
      excelTotal: nullableNumber(raw.score.excelTotal),
      delta: nullableNumber(raw.score.delta),
    },
    facts: {
      steps: number(raw.facts.steps), runM: number(raw.facts.runM), bikeM: number(raw.facts.bikeM),
      swimM: number(raw.facts.swimM), workoutPoints: number(raw.facts.workoutPoints),
      ...(raw.facts.stepsCalculation ? { stepsCalculation: {
        source: literal(raw.facts.stepsCalculation.source),
        resolvedSteps: number(raw.facts.stepsCalculation.resolvedSteps),
        ...(raw.facts.stepsCalculation.garminSource
          ? { garminSource: literal(raw.facts.stepsCalculation.garminSource) } : {}),
      } } : {}),
      ...(raw.facts.workoutCalculation ? { workoutCalculation: {
        source: literal(raw.facts.workoutCalculation.source),
        resolvedPoints: number(raw.facts.workoutCalculation.resolvedPoints),
        ...(raw.facts.workoutCalculation.workingSets === undefined ? {}
          : { workingSets: number(raw.facts.workoutCalculation.workingSets) }),
      } } : {}),
    },
    ledger: ledger.map(item => {
      if (!object(item) || (item.rule != null && !object(item.rule))) invalidResponse();
      return {
        id: literal(item.id),
        name: item.rule?.name == null ? 'Unspecified contribution' : literal(item.rule.name),
        type: item.rule?.activityType == null ? null : literal(item.rule.activityType),
        points: number(item.points),
      };
    }),
    activityCount: activities.length,
    sourceTypes: [...new Set(activities.map(item => {
      if (!object(item)) invalidResponse();
      return literal(item.source);
    }))],
  };
  return result;
}
