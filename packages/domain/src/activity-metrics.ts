/** Activity-level catalog only. FIT input has already been decoded/scaled;
 * no telemetry, narrative, developer fields or scoring enter this boundary. */
export const ACTIVITY_METRIC_PARSER_VERSION = 1;
export type MetricProvider = 'strava' | 'garmin';
export type MetricSourceKind = 'compact' | 'strava_detail' | 'fit_session' | 'strength_summary' | 'canonical_fallback';
export type MetricSport = 'walk' | 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | 'hiit';
export interface MetricMapping {
  provider: MetricProvider; sourceKind: MetricSourceKind; field: string; sourceUnit: string;
  factor: number; origin: 'recorded' | 'provider_derived'; precedence: number;
}
export interface MetricDefinition {
  key: string; label: string; dimension: string; unit: string; sports: readonly MetricSport[];
  min: number; max: number; integer?: boolean; canonicalColumn?: string;
  priority: readonly MetricProvider[]; mappings: readonly MetricMapping[];
  missing: 'absent_is_missing';
}
const all: MetricSport[] = ['walk','run','bike','swim','workout','rowing','sup','hiit'];
const moving: MetricSport[] = ['walk','run','bike','swim','rowing','sup'];
const strava = (field: string, unit: string, factor = 1): MetricMapping[] => ['compact','strava_detail'].map(sourceKind => ({ provider: 'strava', sourceKind: sourceKind as MetricSourceKind, field, sourceUnit: unit, factor, origin: 'provider_derived', precedence: sourceKind === 'compact' ? 10 : 20 }));
const fit = (field: string, unit: string, factor = 1, precedence = 30): MetricMapping => ({ provider: 'garmin', sourceKind: 'fit_session', field, sourceUnit: unit, factor, origin: 'recorded', precedence });
const compact = (field: string, unit: string): MetricMapping => ({ provider: 'garmin', sourceKind: 'compact', field, sourceUnit: unit, factor: 1, origin: 'provider_derived', precedence: 10 });
function metric(key: string, label: string, dimension: string, unit: string, max: number, mappings: MetricMapping[], options: Partial<MetricDefinition> = {}): MetricDefinition {
  return { key, label, dimension, unit, max, min: 0, sports: all, priority: ['strava','garmin'], missing: 'absent_is_missing', mappings, ...options };
}
/** Official Strava API reference and Garmin FIT session profile. Unitless FIT
 * fields use the decoder's empty/null unit only; unfamiliar units are rejected. */
export const ACTIVITY_METRIC_CATALOG: readonly MetricDefinition[] = [
  metric('distance','Distance','length','m',1_000_000,[...strava('distance','m'),compact('distanceM','m'),fit('total_distance','m')],{canonicalColumn:'distance_m'}),
  metric('elapsed_duration','Elapsed duration','time','s',604800,[...strava('elapsed_time','s'),compact('elapsedTimeS','s'),fit('total_elapsed_time','s')],{canonicalColumn:'duration_s'}),
  metric('moving_duration','Moving duration','time','s',604800,[...strava('moving_time','s'),compact('movingTimeS','s')],{canonicalColumn:'moving_time_s'}),
  metric('timer_duration','Garmin timer duration','time','s',604800,[fit('total_timer_time','s')]),
  metric('average_speed','Average speed','speed','m/s',100,[...strava('average_speed','m/s'),fit('avg_speed','m/s'),fit('enhanced_avg_speed','m/s',1,40)],{canonicalColumn:'avg_speed_mps',sports:moving}),
  metric('maximum_speed','Maximum speed','speed','m/s',100,[...strava('max_speed','m/s'),fit('max_speed','m/s'),fit('enhanced_max_speed','m/s',1,40)],{sports:moving}),
  metric('average_pace','Average moving pace','pace','s/km',36000,[],{canonicalColumn:'avg_pace_s_per_km',sports:moving}),
  metric('average_heart_rate','Average heart rate','frequency','bpm',255,[...strava('average_heartrate','bpm'),fit('avg_heart_rate','bpm')],{canonicalColumn:'avg_hr',min:1}),
  metric('maximum_heart_rate','Maximum heart rate','frequency','bpm',255,[...strava('max_heartrate','bpm'),fit('max_heart_rate','bpm')],{canonicalColumn:'max_hr',min:1}),
  metric('calories','Calories','energy','kcal',100000,[...strava('calories','kcal'),fit('total_calories','kcal')],{canonicalColumn:'calories'}),
  metric('ascent','Ascent','length','m',100000,[...strava('total_elevation_gain','m'),fit('total_ascent','m')],{canonicalColumn:'elevation_gain_m'}),
  metric('descent','Descent','length','m',100000,[fit('total_descent','m')]),
  metric('average_temperature','Average temperature','temperature','C',100,[...strava('average_temp','C'),fit('avg_temperature','C')],{min:-100}),
  // Strava documents cadence as rpm; do not invent step/stride conversion for
  // running. Garmin's explicit running subfield has verified stride semantics.
  metric('average_cadence','Average general cadence','cadence','rpm',300,[...strava('average_cadence','rpm'),fit('avg_cadence','rpm')],{sports:['run','bike'],priority:['strava','garmin']}),
  metric('running_cadence','Average running cadence','cadence','steps/min',500,[fit('avg_running_cadence','strides/min',2)],{sports:['run'],priority:['garmin']}),
  metric('maximum_running_cadence','Maximum running cadence','cadence','steps/min',500,[fit('max_running_cadence','strides/min',2)],{sports:['run'],priority:['garmin']}),
  metric('maximum_cadence','Maximum cadence','cadence','rpm',300,[fit('max_cadence','rpm')],{sports:['bike']}),
  metric('step_length','Average step length','length','m',5,[fit('avg_step_length','mm',0.001)],{sports:['run'],priority:['garmin']}),
  metric('vertical_oscillation','Vertical oscillation','length','mm',300,[fit('avg_vertical_oscillation','mm')],{sports:['run'],priority:['garmin']}),
  metric('vertical_ratio','Vertical ratio','ratio','%',100,[fit('avg_vertical_ratio','percent')],{sports:['run'],priority:['garmin']}),
  metric('ground_contact_time','Ground contact time','time','ms',2000,[fit('avg_stance_time','ms')],{sports:['run'],priority:['garmin']}),
  metric('ground_contact_balance','Ground contact balance','ratio','%',100,[fit('avg_stance_time_balance','percent')],{sports:['run'],priority:['garmin']}),
  metric('stance_time_ratio','Stance time ratio','ratio','%',100,[fit('avg_stance_time_percent','percent')],{sports:['run'],priority:['garmin']}),
  metric('average_power','Average power','power','W',10000,[...strava('average_watts','W'),fit('avg_power','watts')],{sports:['run','bike','rowing','sup']}),
  metric('maximum_power','Maximum power','power','W',10000,[...strava('max_watts','W'),fit('max_power','watts')],{sports:['run','bike','rowing','sup']}),
  metric('weighted_average_power','Strava weighted average power','power','W',10000,[...strava('weighted_average_watts','W')],{sports:['bike'],priority:['strava']}),
  metric('total_work','Total work','energy','kJ',100000,[...strava('kilojoules','kJ'),fit('total_work','J',0.001)]),
  metric('aerobic_training_effect','Garmin aerobic Training Effect','provider_index','TE',5,[fit('total_training_effect','')],{priority:['garmin']}),
  metric('anaerobic_training_effect','Garmin anaerobic Training Effect','provider_index','TE',5,[fit('total_anaerobic_training_effect','')],{priority:['garmin']}),
  metric('relative_effort','Strava Relative Effort','provider_index','RE',100000,[...strava('suffer_score','RE')],{priority:['strava']}),
  metric('normalized_power','FIT normalized power','power','W',10000,[fit('normalized_power','watts')],{sports:['bike'],priority:['garmin']}),
  metric('training_stress','FIT training stress','provider_index','tss',10000,[fit('training_stress_score','tss')],{sports:['bike'],priority:['garmin']}),
  metric('pool_length','Pool length','length','m',200,[fit('pool_length','m')],{sports:['swim'],min:1}),
  metric('length_count','Pool lengths','count','lengths',10000,[fit('num_lengths','lengths')],{sports:['swim'],integer:true}),
  metric('active_length_count','Active pool lengths','count','lengths',10000,[fit('num_active_lengths','lengths')],{sports:['swim'],integer:true}),
  metric('lap_count','Laps','count','laps',10000,[fit('num_laps','')],{integer:true}),
  metric('stroke_count','Stroke count','count','strokes',100000,[fit('stroke_count','counts')],{sports:['swim','rowing','sup'],integer:true}),
  metric('stroke_rate','Average stroke rate','cadence','strokes/min',300,[fit('avg_swimming_cadence','strokes/min'),fit('avg_paddlesport_cadence','strokes/min')],{sports:['swim','rowing','sup']}),
  metric('strokes_per_length','Strokes per length','count','strokes/length',1000,[fit('avg_strokes_per_length','strokes/length')],{sports:['swim']}),
  metric('swolf','Average SWOLF','provider_index','SWOLF',1000,[fit('avg_swolf','')],{sports:['swim']}),
  metric('distance_per_stroke','Distance per stroke','length','m/stroke',100,[fit('avg_stroke_distance','m')],{sports:['swim','rowing','sup']}),
  ...(['workingSets','totalRecordedSets','restMarkers','warmupSets','unknownSets','exerciseCount'] as const).map(field => metric(`strength_${field}`, field.replace(/([A-Z])/g,' $1'), 'count','count',2000,[{provider:'garmin',sourceKind:'strength_summary',field,sourceUnit:'count',factor:1,origin:'provider_derived',precedence:50}],{sports:['workout'],priority:['garmin'],integer:true})),
];
export interface MetricInput { provider: MetricProvider; sourceKind: MetricSourceKind; fields: unknown; }
export interface MetricObservation {
  metricKey: string; value: number; unit: string; sourceKind: MetricSourceKind;
  sourceField: string; sourceUnit: string; origin: 'recorded' | 'provider_derived' | 'calculated'; precedence: number;
}
export interface MetricInspection { observations: MetricObservation[]; missing: number; rejected: number; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function inspectActivityMetrics(sport: string, inputs: readonly MetricInput[]): MetricInspection {
  if (new Set(inputs.map(input=>input.provider)).size>1) throw new Error('Inspect one provider at a time to preserve disagreements.');
  const observations: MetricObservation[] = []; let missing = 0; let rejected = 0;
  for (const definition of ACTIVITY_METRIC_CATALOG.filter(metric => metric.sports.includes(sport as MetricSport))) {
    let present = false;
    for (const input of inputs) {
      const root = object(input.fields);
      for (const mapping of definition.mappings.filter(m => m.provider === input.provider && m.sourceKind === input.sourceKind)) {
        let value: unknown; let unit = mapping.sourceUnit;
        if (input.sourceKind === 'fit_session') {
          if (root.message !== 'session' || !Array.isArray(root.fields)) continue;
          const matches = root.fields.filter(f => { const field = object(f); return field.name === mapping.field && (field.developerIndex === null || field.developerIndex === undefined); });
          if (matches.length !== 1) { if (matches.length) rejected++; continue; }
          const field = object(matches[0]); value = field.value; unit = typeof field.units === 'string' ? field.units : field.units === null || field.units === undefined ? '' : 'unknown';
        } else value = root[mapping.field];
        if (value === null || value === undefined) continue;
        const normalized = typeof value === 'number' ? value * mapping.factor : NaN;
        if (!Number.isFinite(normalized) || unit !== mapping.sourceUnit || normalized < definition.min || normalized > definition.max || (definition.integer && !Number.isInteger(normalized))) { rejected++; continue; }
        present = true; observations.push({ metricKey:definition.key, value:normalized, unit:definition.unit, sourceKind:input.sourceKind, sourceField:mapping.field, sourceUnit:unit, origin:mapping.origin, precedence:mapping.precedence });
      }
    }
    if (!present) missing++;
  }
  // Pace uses moving duration/distance from the same provider and same origin.
  // Timer duration is never silently substituted for moving time.
  if (moving.includes(sport as MetricSport)) for (const input of inputs) {
    const distance = observations.find(o => o.sourceKind === input.sourceKind && o.metricKey === 'distance');
    const duration = observations.find(o => o.sourceKind === input.sourceKind && o.metricKey === 'moving_duration');
    if (distance && duration && distance.value > 0 && duration.value > 0) {
      const value = duration.value * 1000 / distance.value;
      if (value <= 36000) observations.push({ metricKey:'average_pace',value,unit:'s/km',sourceKind:input.sourceKind,sourceField:'moving_duration/distance',sourceUnit:'s/m',origin:'calculated',precedence:duration.precedence });
    }
  }
  return { observations, missing:Math.max(0, missing - (observations.some(o => o.metricKey === 'average_pace') ? 1 : 0)), rejected };
}
export function selectProviderMetrics(observations: readonly MetricObservation[]): MetricObservation[] {
  const selected = new Map<string, MetricObservation>();
  for (const observation of [...observations].sort((a,b) => b.precedence-a.precedence || a.sourceField.localeCompare(b.sourceField))) if (!selected.has(observation.metricKey)) selected.set(observation.metricKey,observation);
  return [...selected.values()].sort((a,b) => a.metricKey.localeCompare(b.metricKey));
}
