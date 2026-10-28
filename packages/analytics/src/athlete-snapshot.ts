/** Pure, deterministic athlete observations. No database, providers, scoring or forecasts. */
export const DISCIPLINES = ['run', 'bike', 'swim'] as const;
export type Discipline = typeof DISCIPLINES[number];
export const SNAPSHOT_VERSION = 'sportos.athlete-snapshot.v1' as const;
export const CALCULATION_VERSION = 'canonical-calendar-v1' as const;
export const WINDOWS = [7, 28, 30, 90, 180, 365] as const;
export interface AthleteActivity {
  id: string; date: string; discipline: Discipline; subtype: string | null; source: string;
  distanceM: number | null; recordedDistanceM: number | null; distanceCorrected: boolean;
  elapsedS: number | null; movingS: number | null; avgHrBpm: number | null; maxHrBpm: number | null;
  elevationM: number | null; updatedAt: string;
  historicalSummary: boolean;
}
export interface Supplement {
  activityId: string; provider: 'strava' | 'garmin'; key: string; value: number; unit: string;
  origin: string; projectedAt: string;
}
export interface RunBest {
  targetDistanceM: number; total: number; coverage: Record<string, number>;
  rows: { activityId: string | null; eventId: string | null; date: string; durationS: number;
    source: string; pausePolicy: string; rank: number; alternativeCount: number }[];
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function monday(date: string): string {
  return shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const round = (n: number) => Math.round(n * 1000) / 1000;
const mean = (v: number[]) => v.length ? round(v.reduce((a,b)=>a+b,0)/v.length) : null;
const median = (v: number[]) => { const s=[...v].sort((a,b)=>a-b); return s.length ? round((s[Math.floor((s.length-1)/2)] + s[Math.floor(s.length/2)])/2) : null; };
const positive = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;
export function activityEvidence(a: AthleteActivity) {
  const durationS = positive(a.movingS) ? a.movingS : positive(a.elapsedS) ? a.elapsedS : null;
  const pace = durationS !== null && positive(a.distanceM) ? durationS / (a.distanceM / 1000) : null;
  return {...a, method: a.historicalSummary ? 'summary_estimated' as const : 'measured' as const,
    evidenceType: 'whole_activity' as const, durationBasis: positive(a.movingS) ? 'moving' : positive(a.elapsedS) ? 'elapsed_fallback' : 'unavailable',
    paceSPerKm: pace === null ? null : round(pace), paceSPer100m: a.discipline==='swim' && pace!==null ? round(pace/10) : null,
    speedKmh: pace!==null && pace>0 ? round(3600/pace) : null,
    caveats: [ ...(a.distanceCorrected ? ['manual_distance_correction'] : []), ...(a.historicalSummary ? ['historical_summary_not_interval_evidence'] : []),
      ...(!positive(a.movingS) ? ['moving_time_unavailable'] : []), ...(a.subtype===null || a.subtype==='unknown' ? ['conditions_unknown'] : []) ]};
}
export type ActivityEvidence = ReturnType<typeof activityEvidence>;
export function aggregate(rows: readonly AthleteActivity[], from: string, to: string) {
  const distance = rows.filter(a=>a.distanceM!==null && a.distanceM>=0);
  const moving = rows.filter(a=>a.movingS!==null && a.movingS>=0);
  const elapsed = rows.filter(a=>a.elapsedS!==null && a.elapsedS>=0);
  const paired = rows.filter(a=>positive(a.distanceM) && (positive(a.movingS)||positive(a.elapsedS)));
  const paces = paired.map(a=>(positive(a.movingS)?a.movingS:a.elapsedS!) / (a.distanceM!/1000));
  const pairedDistance = paired.reduce((s,a)=>s+a.distanceM!,0);
  const pairedTime = paired.reduce((s,a)=>s+(positive(a.movingS)?a.movingS:a.elapsedS!),0);
  const activeDays = new Set(rows.map(a=>a.date)).size;
  const days = Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  const total = (items: readonly AthleteActivity[], field: 'distanceM'|'movingS'|'elapsedS') => items.length ? round(items.reduce((s,a)=>s+a[field]!,0)) : null;
  return {from,to,calendarDays:days,sessions:rows.length,activeDays,sessionsPerWeek:round(rows.length*7/days),
    distanceM:total(distance,'distanceM'),movingS:total(moving,'movingS'),elapsedS:total(elapsed,'elapsedS'),
    distanceKnown:distance.length,movingKnown:moving.length,elapsedKnown:elapsed.length,
    averageSessionMovingS:mean(moving.map(a=>a.movingS!)),medianSessionMovingS:median(moving.map(a=>a.movingS!)),
    averageSessionDistanceM:mean(distance.map(a=>a.distanceM!)),medianSessionDistanceM:median(distance.map(a=>a.distanceM!)),
    meanSessionPaceSPerKm:mean(paces),medianSessionPaceSPerKm:median(paces),
    weightedPaceSPerKm:pairedDistance>0?round(pairedTime/(pairedDistance/1000)):null,pacePairedSessions:paired.length,
    paceMovingSessions:paired.filter(a=>positive(a.movingS)).length,paceElapsedFallbackSessions:paired.filter(a=>!positive(a.movingS)).length,
    meanRecordedHrBpm:mean(rows.map(a=>a.avgHrBpm).filter(positive)),hrKnown:rows.filter(a=>positive(a.avgHrBpm)).length,
    elevationM:rows.some(a=>a.elevationM!==null)?round(rows.reduce((s,a)=>s+(a.elevationM??0),0)):null,
    elevationKnown:rows.filter(a=>a.elevationM!==null).length,
    sourceCounts:Object.fromEntries([...new Set(rows.map(a=>a.source))].sort().map(source=>[source,rows.filter(a=>a.source===source).length])),
    subtypeCounts:Object.fromEntries([...new Set(rows.map(a=>a.subtype??'unknown'))].sort().map(subtype=>[subtype,rows.filter(a=>(a.subtype??'unknown')===subtype).length])),
    correctedSessions:rows.filter(a=>a.distanceCorrected).length,historicalSummarySessions:rows.filter(a=>a.historicalSummary).length};
}
export type Volume = ReturnType<typeof aggregate>;
export function volumeBuckets(rows: readonly AthleteActivity[], from: string, to: string, period: 'daily'|'weekly'|'monthly'|'annual') {
  const groups = new Map<string,AthleteActivity[]>();
  for (const a of rows) { const key=period==='daily'?a.date:period==='weekly'?monday(a.date):period==='monthly'?a.date.slice(0,7)+'-01':a.date.slice(0,4)+'-01-01';
    groups.set(key,[...(groups.get(key)??[]),a]); }
  // Include empty calendar buckets; zero recorded sessions never proves rest.
  const keys=new Set<string>();
  for(let date=from;date<=to;date=shiftDate(date,1)) keys.add(period==='daily'?date:period==='weekly'?monday(date):period==='monthly'?date.slice(0,7)+'-01':date.slice(0,4)+'-01-01');
  return [...keys].sort().map(key=>{const end=period==='daily'?key:period==='weekly'?shiftDate(key,6):period==='annual'?key.slice(0,4)+'-12-31':shiftDate(new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5,7)),1,12)).toISOString().slice(0,10),-1);
    const start=key<from?from:key, stop=end>to?to:end, bucket=groups.get(key)??[];
    return {key,partial:start!==key||stop!==end,disciplines:Object.fromEntries(DISCIPLINES.map(s=>[s,aggregate(bucket.filter(a=>a.discipline===s),start,stop)])) as Record<Discipline,Volume>};});
}
export function buildAthleteSnapshot(input: {activities: AthleteActivity[]; supplements: Supplement[]; runningBests: RunBest[]; recentRunningBests: RunBest[]; asOfDate: string; timezone: string; generatedAt: string; windows?: readonly number[]}) {
  const {asOfDate,timezone,generatedAt}=input;
  // Identical canonical IDs converge. Conflicting duplicates fail rather than choose.
  const unique=new Map<string,AthleteActivity>();
  for(const a of input.activities) { const prior=unique.get(a.id); if(prior && JSON.stringify(prior)!==JSON.stringify(a)) throw Error('Conflicting canonical activity.'); unique.set(a.id,a); }
  const all=[...unique.values()].filter(a=>a.date<=asOfDate).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const today=localDate(new Date(generatedAt),timezone), completeTo=asOfDate>=today?shiftDate(today,-1):asOfDate;
  const rows=all.filter(a=>a.date<=completeTo),first=rows[0]?.date??completeTo;
  const lastMonday=monday(shiftDate(completeTo,1)); // Last 52 fully complete Mon–Sun weeks.
  const weekTo=shiftDate(lastMonday,-1),weekFrom=shiftDate(lastMonday,-364);
  const monthFrom=shiftDate(new Date(Date.UTC(Number(completeTo.slice(0,4)),Number(completeTo.slice(5,7))-12,1,12)).toISOString().slice(0,10),0);
  const windows=input.windows??WINDOWS;
  const summarize=(s: Discipline)=>{const items=rows.filter(a=>a.discipline===s),byLength=[...items].filter(a=>positive(a.distanceM)).sort((a,b)=>b.distanceM!-a.distanceM!||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
    const metrics=input.supplements.filter(m=>items.some(a=>a.id===m.activityId));
    return {lifetime:aggregate(items,first,completeTo),windows:windows.map(days=>({days,...aggregate(items.filter(a=>a.date>=shiftDate(completeTo,1-days)),shiftDate(completeTo,1-days),completeTo)})),
      longest:byLength.slice(0,15).map(activityEvidence),recent:items.slice(-15).reverse().map(activityEvidence),recentLongest:byLength.filter(a=>a.date>=shiftDate(completeTo,-89)).slice(0,10).map(activityEvidence),
      distanceDistribution:[0,1000,5000,10000,20000,50000,100000,180000].map((min,i,bounds)=>({minM:min,maxM:bounds[i+1]??null,sessions:items.filter(a=>a.distanceM!==null&&a.distanceM>=min&&(bounds[i+1]===undefined||a.distanceM<bounds[i+1])).length})),
      paceDistribution:[0,180,240,300,360,480,600,1200].map((min,i,bounds)=>({minSPerKm:min,maxSPerKm:bounds[i+1]??null,sessions:items.map(activityEvidence).filter(a=>a.paceSPerKm!==null&&a.paceSPerKm>=min&&(bounds[i+1]===undefined||a.paceSPerKm<bounds[i+1])).length})),
      metrics:[...new Set(metrics.map(m=>m.key))].sort().map(key=>{const values=metrics.filter(m=>m.key===key);return {key,unit:values[0].unit,sessions:new Set(values.map(m=>m.activityId)).size,mean:mean(values.map(m=>m.value)),median:median(values.map(m=>m.value)),min:Math.min(...values.map(m=>m.value)),max:Math.max(...values.map(m=>m.value)),evidence:values.slice(-5)};}),
      wholeActivityBenchmarks:(s==='bike'?[20000,40000,90000,180000]:s==='swim'?[100,400,1000,1500,1900,3800]:[5000,10000,21097.5,42195]).map(targetDistanceM=>({targetDistanceM,toleranceM:Math.max(1,targetDistanceM*.01),
        candidates:items.filter(a=>positive(a.distanceM)&&Math.abs(a.distanceM-targetDistanceM)<=Math.max(1,targetDistanceM*.01)&&!a.historicalSummary).map(activityEvidence).filter(a=>a.elapsedS!==null&&a.elapsedS>0).sort((a,b)=>a.elapsedS!-b.elapsedS!||a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).slice(0,5)}))};};
  const disciplines=Object.fromEntries(DISCIPLINES.map(s=>[s,summarize(s)])) as Record<Discipline,ReturnType<typeof summarize>>;
  return {schemaVersion:SNAPSHOT_VERSION,calculationVersion:CALCULATION_VERSION,generatedAt,asOfDate,timezone,completeThrough:completeTo,
    sourcePolicy:{primary:'canonical_activity_strava_priority',supplement:'current_allowlisted_provider_metric_projections',deduplication:'canonical_uuid',narrative:'excluded',providerReads:'retained_only'},
    units:{distance:'m',duration:'s',heartRate:'bpm',power:'W',pace:'s/km',swimPace:'s/100m',speed:'km/h'},
    coverage:{canonicalSessions:rows.length,firstDate:rows[0]?.date??null,lastDate:rows.at(-1)?.date??null,lastCanonicalUpdate:rows.length?rows.map(a=>a.updatedAt).sort().at(-1)!:null,
      incompleteDayExcluded:asOfDate>=today,incompleteDaySessions:all.filter(a=>a.date>completeTo).length,archiveCompleteness:'unknown',providerSyncFreshness:'not_inferred_from_activity_dates',
      projectedMetricSessions:new Set(input.supplements.filter(m=>rows.some(a=>a.id===m.activityId)).map(m=>m.activityId)).size},
    disciplines,annual:volumeBuckets(rows,first,completeTo,'annual'),monthly:volumeBuckets(rows.filter(a=>a.date>=monthFrom),monthFrom,completeTo,'monthly'),
    completeWeeks:volumeBuckets(rows.filter(a=>a.date>=weekFrom&&a.date<=weekTo),weekFrom,weekTo,'weekly'),
    runningBests:input.runningBests,recentRunningBests:input.recentRunningBests,
    knownUnknowns:['FTP, CSS, physiological zones, threshold and VO2max are not established by this snapshot.', 'Race certification, course, weather, drafting, open-water safety and fueling are not established by activity summaries.', 'No retained interval evidence is synthesized from average session pace.', 'Same-day multisport sessions do not establish a brick or transition practice.'],
    limitations:['No provider fetch, synchronization or recomputation performed.', 'Coverage describes retained records; missing sessions do not establish rest or complete archive processing.', 'Calendar activity dates preserve source-local dates; timezone labels window and incomplete-day policy, and does not reassign source dates.', 'Pace uses positive moving seconds, else elapsed fallback, on paired positive distance/time only; moving and elapsed totals remain separate.', 'Whole-activity benchmark tolerance is 1% (minimum 1 metre); exact recorded distance and elapsed time remain authoritative; no split normalization.', 'Historical summary reconstructed activities are summary_estimated, excluded from whole-activity benchmark ranking.', 'Running leaderboards preserve historical imported authority and current stream-calculated continuous efforts; they are separate from whole-activity averages.', 'Provider indices are observations, not physiological diagnoses or readiness estimates.']};
}
export type AthleteSnapshot = ReturnType<typeof buildAthleteSnapshot>;
