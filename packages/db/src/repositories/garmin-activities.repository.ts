import { createHash } from 'node:crypto';
import { sql, type Kysely, type Selectable } from 'kysely';
import { matchGarminActivity, validateActivityMatchSummary, type ActivityMatchSummary, type ActivityMatchResult } from '@sportos/domain';
import type { Database, Json, Activity } from '../schema.js';
import type { GarminActivityIdentitiesTable } from '../garmin-activity-schema.js';

type Identity = Selectable<GarminActivityIdentitiesTable>;
export interface GarminActivitySnapshot {
  provider: 'garmin';
  providerActivityId: string | null;
  contentHash: string;
  origin: 'archive' | 'connect';
  sourceUpdatedAt: Date;
  summary: ActivityMatchSummary;
}
export class GarminReconciliationConflict extends Error {}

/** Share this lock with Strava ingestion: serialize matching, not provider I/O. */
export async function lockActivityReconciliation(db: Kysely<Database>): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended('sportos.activity-reconciliation:' || current_setting('sportos.account_id'), 0))`.execute(db);
}

export function garminIdentityKey(input: Pick<GarminActivitySnapshot, 'providerActivityId' | 'summary'>): string {
  validateActivityMatchSummary(input.summary);
  if (input.providerActivityId !== null) {
    if (!/^[0-9]{1,20}$/.test(input.providerActivityId) || BigInt(input.providerActivityId) === 0n) throw new Error('Invalid Garmin activity ID.');
    return `native:${BigInt(input.providerActivityId)}`;
  }
  return `fingerprint:v1:${createHash('sha256').update(JSON.stringify(compactSummary(input.summary))).digest('hex')}`;
}

export class GarminActivitiesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async ingest(input: GarminActivitySnapshot) {
    validateSnapshot(input);
    const key = garminIdentityKey(input);
    return this.db.transaction().execute(async (tx) => {
      await lockActivityReconciliation(tx);
      const existing = await tx.selectFrom('garmin_activity_identities').selectAll().where('identity_key', '=', key).forUpdate().executeTakeFirst();
      let identity = existing ?? await tx.insertInto('garmin_activity_identities').values({
        identity_key: key, identity_kind: input.providerActivityId === null ? 'fingerprint_v1' : 'native',
        activity_id: null, status: 'unmatched', ...summaryColumns(input.summary),
        current_hash: input.contentHash, source_updated_at: input.sourceUpdatedAt, match_evidence: {},
      }).returningAll().executeTakeFirstOrThrow();
      const summary = compactSummary(input.summary);
      const sameVersion = await tx.selectFrom('garmin_activity_versions').select(['summary_json'])
        .where('identity_id', '=', identity.id).where('content_hash', '=', input.contentHash).executeTakeFirst();
      if (sameVersion && stableJson(sameVersion.summary_json) !== stableJson(summary)) {
        throw new GarminReconciliationConflict('Same content hash has conflicting normalized metadata.');
      }
      const inserted = await tx.insertInto('garmin_activity_versions').values({
        identity_id: identity.id, content_hash: input.contentHash, origin: input.origin,
        source_updated_at: input.sourceUpdatedAt, summary_json: summary,
      }).onConflict((oc) => oc.columns(['owner_id', 'identity_id', 'content_hash', 'origin']).doNothing()).returning('id').executeTakeFirst();
      const changed = existing !== undefined && existing.current_hash !== input.contentHash;
      const newer = input.sourceUpdatedAt.getTime() > identity.source_updated_at.getTime();
      // Tie-break equal source timestamps deterministically; linked UUID never changes.
      if (changed && (newer || (input.sourceUpdatedAt.getTime() === identity.source_updated_at.getTime() && input.contentHash > identity.current_hash))) {
        identity = await tx.updateTable('garmin_activity_identities').set({
          ...summaryColumns(input.summary), current_hash: input.contentHash,
          source_updated_at: input.sourceUpdatedAt, updated_at: new Date(),
        }).where('id', '=', identity.id).returningAll().executeTakeFirstOrThrow();
      }
      if (identity.activity_id === null && identity.status !== 'rejected') identity = await this.resolve(tx, identity);
      return { ...publicIdentity(identity), versionAdded: inserted !== undefined, changed };
    });
  }

  async get(id: string) {
    const row = await this.db.selectFrom('garmin_activity_identities').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? publicIdentity(row) : null;
  }

  async list(limit = 50, offset = 0) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error('Invalid reconciliation pagination.');
    return (await this.db.selectFrom('garmin_activity_identities').selectAll().orderBy('start_time', 'desc').orderBy('id', 'asc').limit(limit).offset(offset).execute()).map(publicIdentity);
  }

  async audit(id: string) {
    return this.db.selectFrom('garmin_reconciliation_audit').select(['id', 'activity_id as activityId', 'action', 'policy_version as policyVersion', 'evidence_json as evidence', 'created_at as createdAt'])
      .where('identity_id', '=', id).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(100).execute();
  }

  /** Called inside the existing Strava transaction. A bounded window avoids a full scan. */
  async reconcileNear(startTime: Date): Promise<void> {
    const pending = await this.db.selectFrom('garmin_activity_identities').selectAll()
      .where('activity_id', 'is', null).where('status', '!=', 'rejected')
      .where('start_time', '>=', new Date(startTime.getTime() - 120000))
      .where('start_time', '<=', new Date(startTime.getTime() + 120000))
      .orderBy('id', 'asc').limit(100).forUpdate().execute();
    for (const row of pending) await this.resolve(this.db, row);
  }

  async review(id: string, decision: 'link' | 'reject' | 'reopen', activityId: string | null = null) {
    return this.db.transaction().execute(async (tx) => {
      await lockActivityReconciliation(tx);
      const identity = await tx.selectFrom('garmin_activity_identities').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!identity) return null;
      if (decision === 'link') {
        const activity = activityId ? await tx.selectFrom('activities').selectAll().where('id', '=', activityId).where('source', 'in', ['strava', 'manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets']).executeTakeFirst() : null;
        if (!activity) return null; // Identical result for foreign and absent identifiers.
        if (identity.activity_id === activityId && identity.status === 'manual') return publicIdentity(identity);
        if (identity.activity_id !== null) throw new GarminReconciliationConflict('Reject the existing link before assigning another activity.');
        const occupied = await tx.selectFrom('garmin_activity_identities').select('id').where('activity_id', '=', activityId).executeTakeFirst();
        if (occupied) throw new GarminReconciliationConflict('Activity already has a Garmin identity.');
      } else if (activityId !== null) throw new Error('Unexpected activity identifier.');
      const nextActivity = decision === 'link' ? activityId : null;
      const status = decision === 'link' ? 'manual' : decision === 'reject' ? 'rejected' : 'unmatched';
      if (decision === 'reopen' && identity.activity_id !== null) throw new GarminReconciliationConflict('Reject the existing link before reopening reconciliation.');
      const evidence = { policyVersion: 1, previousActivityId: identity.activity_id, previousStatus: identity.status };
      await tx.insertInto('garmin_reconciliation_audit').values({ identity_id: id, activity_id: nextActivity ?? identity.activity_id,
        action: decision === 'link' ? 'manual_link' : decision === 'reject' ? 'reject' : 'reopen', policy_version: 1, evidence_json: evidence }).execute();
      let row = await tx.updateTable('garmin_activity_identities').set({ activity_id: nextActivity, status, match_evidence: evidence, updated_at: new Date() })
        .where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      if (decision === 'reopen') row = await this.resolve(tx, row);
      return publicIdentity(row);
    });
  }

  private async resolve(tx: Kysely<Database>, identity: Identity): Promise<Identity> {
    const rows = await tx.selectFrom('activities').selectAll()
      .where('source', 'in', ['strava', 'manual', 'my_sport_xlsx', 'run_db_xlsx', 'google_sheets'])
      .where('activity_type', '=', identity.activity_type)
      .where('start_time', '>=', new Date(identity.start_time.getTime() - 120000))
      .where('start_time', '<=', new Date(identity.start_time.getTime() + 120000))
      .orderBy('id', 'asc').limit(101).execute();
    let result: ActivityMatchResult;
    if (rows.length > 100) result = { policyVersion: 1, status: 'ambiguous', activityId: null, candidates: [] };
    else result = matchGarminActivity(identitySummary(identity), rows.map(canonicalSummary));
    if (identity.identity_kind === 'fingerprint_v1') result = { ...result, status: 'ambiguous', activityId: null };
    if (result.activityId !== null) {
      const occupied = await tx.selectFrom('garmin_activity_identities').select('id').where('activity_id', '=', result.activityId).executeTakeFirst();
      if (occupied) result = { ...result, status: 'ambiguous', activityId: null };
    }
    const evidence: Json = { ...result, candidates: result.candidates.map((c) => ({ ...c })),
      reason: rows.length > 100 ? 'CANDIDATE_LIMIT' : identity.identity_kind === 'fingerprint_v1' ? 'FALLBACK_IDENTITY_REQUIRES_REVIEW' : result.activityId === null && result.candidates.some((c) => c.confidence !== 'weak') ? 'COMPETING_OR_ALREADY_LINKED_CANDIDATES' : 'POLICY_V1' };
    if (result.activityId) await tx.insertInto('garmin_reconciliation_audit').values({
      identity_id: identity.id, activity_id: result.activityId, action: 'auto_link', policy_version: 1, evidence_json: evidence,
    }).execute();
    return tx.updateTable('garmin_activity_identities').set({ activity_id: result.activityId, status: result.status, match_evidence: evidence, updated_at: new Date() })
      .where('id', '=', identity.id).returningAll().executeTakeFirstOrThrow();
  }
}

function validateSnapshot(input: GarminActivitySnapshot) {
  validateActivityMatchSummary(input.summary);
  if (input.provider !== 'garmin' || !['archive', 'connect'].includes(input.origin)
    || !/^[0-9a-f]{64}$/.test(input.contentHash) || !(input.sourceUpdatedAt instanceof Date) || !Number.isFinite(input.sourceUpdatedAt.getTime())) throw new Error('Invalid Garmin activity snapshot.');
}
function compactSummary(s: ActivityMatchSummary): Record<string, Json> {
  // Construct explicitly: never spread user/provider objects into persistence.
  return { activityType: s.activityType, subtype: s.subtype, startTime: s.startTime.toISOString(), elapsedTimeS: s.elapsedTimeS, movingTimeS: s.movingTimeS, distanceM: s.distanceM };
}
function summaryColumns(s: ActivityMatchSummary) {
  return { activity_type: s.activityType, subtype: s.subtype, start_time: s.startTime, elapsed_time_s: s.elapsedTimeS, moving_time_s: s.movingTimeS, distance_m: s.distanceM };
}
function identitySummary(s: Identity): ActivityMatchSummary {
  return { activityType: s.activity_type, subtype: s.subtype, startTime: s.start_time, elapsedTimeS: s.elapsed_time_s, movingTimeS: s.moving_time_s, distanceM: s.distance_m };
}
function canonicalSummary(a: Activity) {
  const summary = { id: a.id, activityType: a.activity_type, subtype: a.subtype ?? 'unknown', startTime: a.start_time!,
    elapsedTimeS: a.duration_s === null ? null : Number(a.duration_s), movingTimeS: a.moving_time_s === null ? null : Number(a.moving_time_s), distanceM: a.distance_m === null ? null : Number(a.distance_m) };
  try { validateActivityMatchSummary(summary); } catch {
    // Malformed legacy observations remain weak collisions, never disappear
    // from a candidate set and accidentally confer uniqueness on another row.
    summary.elapsedTimeS = null; summary.movingTimeS = null; summary.distanceM = null;
  }
  return summary;
}
function publicIdentity(row: Identity) {
  return { id: row.id, provider: 'garmin' as const, providerActivityId: row.identity_kind === 'native' ? row.identity_key.slice(7) : null,
    identityKind: row.identity_kind, activityId: row.activity_id, status: row.status,
    summary: compactSummary(identitySummary(row)), evidence: row.match_evidence };
}
function stableJson(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(',')}}`;
}
