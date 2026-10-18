/** Retained Excel evidence is a day summary, never proof of individual sessions. */
export interface HistoricalRunRecord {
  id: string; date: string; distanceM: number; durationS: number; treadmill: boolean;
  sourceRecordId: string | null; locked: boolean;
}
export interface HistoricalRunDay {
  date: string; daily: { distanceM: number; sourceRecordId: string; subtype: string } | null;
  records: HistoricalRunRecord[];
  activities: { id: string; distanceM: number | null; subtype: string | null; source: string }[];
}
export interface HistoricalRunPlan {
  date: string;
  create: { source: 'my_sport_xlsx' | 'run_db_xlsx'; sourceRecordId: string; distanceM: number; subtype: string;
    durationS: number | null; timingEventId: string | null; basis: 'daily_total' | 'running_records' } | null;
  links: { eventId: string; activityId: string | null }[];
  warnings: string[];
}
const tolerance = (m: number) => Math.min(10, m * .001);
export function planHistoricalRun(day: HistoricalRunDay): HistoricalRunPlan {
  const plan: HistoricalRunPlan = { date: day.date, create: null, links: [], warnings: [] };
  const records = day.records.filter(r => !r.locked && r.sourceRecordId && r.distanceM > 0 && r.durationS > 0);
  if (!day.activities.length) {
    const distanceM = day.daily?.distanceM ?? Math.max(0, ...records.map(r => r.distanceM));
    const sourceRecordId = day.daily?.sourceRecordId ?? records.find(r => r.distanceM === distanceM)?.sourceRecordId;
    if (!(distanceM > 0) || !sourceRecordId) return plan;
    const subtype = day.daily?.subtype !== 'unknown' ? day.daily?.subtype : undefined;
    const resolvedSubtype = subtype ?? (records.length && records.every(r => r.treadmill) ? 'treadmill' : 'unknown');
    // A subdistance achievement is not the duration of a longer daily total.
    const full = records.filter(r => Math.abs(r.distanceM - distanceM) <= 1 &&
      (!r.treadmill || resolvedSubtype === 'treadmill' || resolvedSubtype === 'unknown'));
    const durations = [...new Set(full.map(r => r.durationS))];
    plan.create = { source: day.daily ? 'my_sport_xlsx' : 'run_db_xlsx', sourceRecordId,
      distanceM, subtype: resolvedSubtype, durationS: durations.length === 1 ? durations[0] : null,
      timingEventId: durations.length === 1 ? full[0].id : null, basis: day.daily ? 'daily_total' : 'running_records' };
    if (!day.daily) plan.warnings.push('record_only_summary_session_count_unknown');
    if (durations.length > 1) plan.warnings.push('conflicting_full_distance_times');
  }
  const candidates = plan.create ? [{ id: null, distanceM: plan.create.distanceM, subtype: plan.create.subtype, source: plan.create.source }] : day.activities;
  for (const record of records) {
    const compatible = candidates.filter(a => ['my_sport_xlsx', 'run_db_xlsx'].includes(a.source) &&
      a.distanceM !== null && a.distanceM >= record.distanceM - tolerance(record.distanceM) &&
      (!record.treadmill || a.subtype === 'treadmill' || a.subtype === 'unknown'));
    if (compatible.length === 1) plan.links.push({ eventId: record.id, activityId: compatible[0].id });
    else plan.warnings.push(compatible.length ? 'multiple_historical_activity_candidates' : 'no_supported_historical_activity');
  }
  return plan;
}
