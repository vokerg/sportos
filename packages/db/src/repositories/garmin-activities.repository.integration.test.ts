import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { GarminActivitiesRepository, garminIdentityKey, type GarminActivitySnapshot } from './garmin-activities.repository.js';
import { ProvidersRepository } from './providers.repository.js';
import { ActivitiesRepository } from './activities.repository.js';

const runtimeUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const dispatcherUrl = process.env.SPORTOS_WORKER_TEST_DATABASE_URL;
const workerDataUrl = process.env.SPORTOS_WORKER_DATA_TEST_DATABASE_URL;
const integration = runtimeUrl ? describe : describe.skip;
// Append-only synthetic provenance intentionally stays in the designated test
// database. Run against an isolated disposable migration database, never production.
integration('Garmin identity and canonical authority under non-owner RLS', () => {
  let db: ReturnType<typeof createDb>; let ownerA: string; let ownerB: string;
  beforeAll(async () => {
    db = createDb(runtimeUrl!);
    const role = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`.execute(db);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    ownerA = await account(); ownerB = await account();
  });
  afterAll(async () => { await db?.destroy(); });
  const scoped = <T>(owner: string, work: (repo: GarminActivitiesRepository) => Promise<T>) => withAccountContext(db, owner, (ctx) => work(new GarminActivitiesRepository(ctx)));
  const snapshot = (id: string, time: string, changes: Partial<GarminActivitySnapshot> = {}): GarminActivitySnapshot => ({
    provider: 'garmin', providerActivityId: id, contentHash: 'a'.repeat(64), origin: 'connect', sourceUpdatedAt: new Date('2095-01-01T00:00:00Z'),
    summary: { activityType: 'run', subtype: 'outdoor', startTime: new Date(time), elapsedTimeS: 1800, movingTimeS: 1750, distanceM: 5000 }, ...changes,
  });

  it('links corrected distance, preserves canonical fields/provenance/scores and converges overlapping sources', async () => {
    const time = '2095-04-01T10:00:00Z'; const canonical = await activity(ownerA, time, 5200);
    const before = await canonicalRows(ownerA);
    const input = snapshot('1001', time);
    const first = await scoped(ownerA, (repo) => repo.ingest(input));
    expect(first).toMatchObject({ activityId: canonical, status: 'strong_unique', versionAdded: true });
    expect(await scoped(ownerA, (repo) => repo.ingest(input))).toMatchObject({ id: first.id, activityId: canonical, versionAdded: false });
    expect(await scoped(ownerA, (repo) => repo.ingest({ ...input, origin: 'archive' }))).toMatchObject({ id: first.id, activityId: canonical, versionAdded: true });
    expect(await canonicalRows(ownerA)).toEqual(before);
    expect(await withAccountContext(db, ownerA, (ctx) => new ActivitiesRepository(ctx).get(canonical))).toMatchObject({ distance_m: 5200, garmin: { identityId: first.id, providerActivityId: '1001', status: 'strong_unique' } });
    const versions = await withAccountContext(db, ownerA, (ctx) => ctx.selectFrom('garmin_activity_versions').selectAll().where('identity_id', '=', first.id).execute());
    expect(versions).toHaveLength(2);
    expect(JSON.stringify(versions)).not.toContain('raw_json');
    expect(await scoped(ownerA, (repo) => repo.audit(first.id))).toHaveLength(1);
  });

  it('retains changed/out-of-order versions without retargeting canonical UUIDs', async () => {
    const time = '2095-04-02T10:00:00Z'; const canonical = await activity(ownerA, time, 5000);
    const input = snapshot('1002', time); const first = await scoped(ownerA, (repo) => repo.ingest(input));
    const changed = { ...input, contentHash: 'b'.repeat(64), sourceUpdatedAt: new Date('2095-01-02T00:00:00Z'), summary: { ...input.summary, startTime: new Date('2095-04-03T10:00:00Z'), distanceM: 6500 } };
    expect(await scoped(ownerA, (repo) => repo.ingest(changed))).toMatchObject({ id: first.id, activityId: canonical, changed: true });
    await scoped(ownerA, (repo) => repo.ingest(input));
    expect(await scoped(ownerA, (repo) => repo.get(first.id))).toMatchObject({ activityId: canonical, summary: { distanceM: 6500 } });
    await expect(scoped(ownerA, (repo) => repo.ingest({ ...input, summary: { ...input.summary, distanceM: 6000 } }))).rejects.toThrow('Same content hash');
  });

  it('stages Garmin-only data, then binds it through later Strava ingestion without duplicate facts', async () => {
    const time = '2095-04-04T10:00:00Z'; const input = snapshot('1004', time);
    const pending = await scoped(ownerA, (repo) => repo.ingest(input));
    expect(pending).toMatchObject({ status: 'unmatched', activityId: null });
    const result = await strava(ownerA, time, 'strava-1004');
    expect(await scoped(ownerA, (repo) => repo.get(pending.id))).toMatchObject({ status: 'strong_unique', activityId: result.activityId });
    expect(await withAccountContext(db, ownerA, (ctx) => new ActivitiesRepository(ctx).list({ from: '2095-04-04', to: '2095-04-04', limit: 100, offset: 0 }))).toMatchObject({ summary: { count: 1, distanceM: 5200 } });
    await strava(ownerA, time, 'strava-1004');
    expect(await scoped(ownerA, (repo) => repo.audit(pending.id))).toHaveLength(1);
  });

  it('reconsiders retained gym evidence under v2 once, preserving explicit links/rejections and canonical facts', async () => {
    const time='2095-04-12T10:00:00Z';
    const input=snapshot('1012',time,{summary:{activityType:'workout',subtype:'indoor',startTime:new Date(time),elapsedTimeS:1800.8,movingTimeS:900,distanceM:0}});
    const pending=await scoped(ownerA,repo=>repo.ingest(input));
    const id=await withAccountContext(db,ownerA,async ctx=>(await ctx.insertInto('activities').values({source:'strava',activity_type:'workout',subtype:'indoor',activity_date:time.slice(0,10),start_time:new Date(time),duration_s:1800,moving_time_s:1800,distance_m:0}).returning('id').executeTakeFirstOrThrow()).id);
    const before=await canonicalRows(ownerA);
    expect(await scoped(ownerA,repo=>repo.reconsider(garminIdentityKey(input),input.contentHash))).toMatchObject({status:'strong_unique',activityId:id});
    expect((await scoped(ownerA,repo=>repo.audit(pending.id)))[0]).toMatchObject({policyVersion:3,action:'auto_link'});
    await scoped(ownerA,repo=>repo.reconsider(garminIdentityKey(input),input.contentHash));
    expect(await scoped(ownerA,repo=>repo.audit(pending.id))).toHaveLength(1);
    expect(await canonicalRows(ownerA)).toEqual(before);
    await scoped(ownerA,repo=>repo.review(pending.id,'reject'));
    expect(await scoped(ownerA,repo=>repo.reconsider(garminIdentityKey(input),input.contentHash))).toMatchObject({status:'rejected',activityId:null});
  });

  it('keeps competing workouts ambiguous and supports audited accept/reject/reopen', async () => {
    const time = '2095-04-05T10:00:00Z'; const a = await activity(ownerA, time, 5000); await activity(ownerA, '2095-04-05T10:01:00Z', 5000);
    const pending = await scoped(ownerA, (repo) => repo.ingest(snapshot('1005', time)));
    expect(pending).toMatchObject({ status: 'ambiguous', activityId: null });
    expect(await scoped(ownerA, (repo) => repo.review(pending.id, 'link', a))).toMatchObject({ status: 'manual', activityId: a });
    expect(await scoped(ownerA, (repo) => repo.review(pending.id, 'reject'))).toMatchObject({ status: 'rejected', activityId: null });
    await scoped(ownerA, (repo) => repo.ingest(snapshot('1005', time)));
    expect(await scoped(ownerA, (repo) => repo.get(pending.id))).toMatchObject({ status: 'rejected' });
    expect(await scoped(ownerA, (repo) => repo.review(pending.id, 'reopen'))).toMatchObject({ status: 'ambiguous', activityId: null });
    expect((await scoped(ownerA, (repo) => repo.audit(pending.id))).map((row) => row.action).sort()).toEqual(['manual_link', 'reject', 'reopen']);
  });

  it('permits explicit unlink followed by canonical deletion while retaining immutable audit evidence', async () => {
    const time = '2095-04-11T10:00:00Z'; const canonical = await activity(ownerA, time, 5000);
    const linked = await scoped(ownerA, (repo) => repo.ingest(snapshot('1011', time)));
    expect(linked.activityId).toBe(canonical);
    await scoped(ownerA, (repo) => repo.review(linked.id, 'reject'));
    await withAccountContext(db, ownerA, (ctx) => ctx.deleteFrom('activities').where('id', '=', canonical).execute());
    const audit = await scoped(ownerA, (repo) => repo.audit(linked.id));
    expect(audit).toHaveLength(2);
    expect(audit.every((row) => row.activityId === canonical)).toBe(true);
    const foreign = await activity(ownerB, '2095-04-12T10:00:00Z', 5000);
    await expect(withAccountContext(db, ownerA, (ctx) => ctx.insertInto('garmin_reconciliation_audit').values({ identity_id: linked.id, activity_id: foreign, action: 'manual_link', policy_version: 1, evidence_json: {} }).execute())).rejects.toThrow('Invalid canonical activity reference');
  });

  it('quarantines fallback fingerprints and never binds two native identities to one canonical', async () => {
    const time = '2095-04-06T10:00:00Z'; const canonical = await activity(ownerA, time, 5000);
    const input = snapshot('1006', time); const first = await scoped(ownerA, (repo) => repo.ingest(input));
    expect(first.activityId).toBe(canonical);
    expect(await scoped(ownerA, (repo) => repo.ingest({ ...input, providerActivityId: '1007' }))).toMatchObject({ activityId: null, status: 'ambiguous' });
    const missing = { ...input, providerActivityId: null };
    expect(garminIdentityKey(missing)).toMatch(/^fingerprint:v1:[a-f0-9]{64}$/);
    const fallback = await scoped(ownerA, (repo) => repo.ingest(missing));
    expect(fallback).toMatchObject({ status: 'ambiguous', identityKind: 'fingerprint_v1', activityId: null });
    expect(await scoped(ownerA, (repo) => repo.ingest(missing))).toMatchObject({ id: fallback.id, versionAdded: false });
  });

  it('serializes concurrent identical delivery and enforces same-owner links, immutable ownership and append-only provenance', async () => {
    const time = '2095-04-07T10:00:00Z'; const input = snapshot('1008', time); const canonical = await activity(ownerA, time, 5000);
    const results = await Promise.all(Array.from({ length: 4 }, () => scoped(ownerA, (repo) => repo.ingest(input))));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.versionAdded)).toHaveLength(1);
    const identity = results[0]!;
    expect(await scoped(ownerB, (repo) => repo.get(identity.id))).toBeNull();
    expect(await scoped(ownerB, (repo) => repo.review(identity.id, 'reject'))).toBeNull();
    const foreign = await scoped(ownerB, (repo) => repo.ingest(input));
    expect(foreign).toMatchObject({ status: 'unmatched', activityId: null });
    expect(await scoped(ownerB, (repo) => repo.review(foreign.id, 'link', canonical))).toBeNull();
    await expect(withAccountContext(db, ownerB, (ctx) => ctx.updateTable('garmin_activity_identities').set({ activity_id: canonical, status: 'manual' }).where('id', '=', foreign.id).execute())).rejects.toThrow();
    await expect(withAccountContext(db, ownerA, (ctx) => ctx.updateTable('garmin_activity_identities').set({ owner_id: ownerB }).where('id', '=', identity.id).execute())).rejects.toThrow('immutable');
    await expect(withAccountContext(db, ownerA, (ctx) => ctx.deleteFrom('garmin_activity_versions').where('identity_id', '=', identity.id).execute())).rejects.toThrow();
    await expect(withAccountContext(db, ownerA, (ctx) => ctx.updateTable('garmin_reconciliation_audit').set({ action: 'reject' }).where('identity_id', '=', identity.id).execute())).rejects.toThrow();
  });

  it.skipIf(!dispatcherUrl)('denies dispatcher access to Garmin metadata/history', async () => {
    const dispatcher = createDb(dispatcherUrl!);
    try {
      for (const table of ['garmin_activity_identities', 'garmin_activity_versions', 'garmin_reconciliation_audit'] as const) await expect(dispatcher.selectFrom(table).selectAll().execute()).rejects.toThrow('permission denied');
    } finally { await dispatcher.destroy(); }
  });
  it.skipIf(!workerDataUrl)('allows owner-scoped worker-data ingestion without canonical promotion', async () => {
    const worker = createDb(workerDataUrl!);
    try {
      const result = await withAccountContext(worker, ownerA, (ctx) => new GarminActivitiesRepository(ctx).ingest(snapshot('1010', '2095-04-10T10:00:00Z')));
      expect(result).toMatchObject({ status: 'unmatched', activityId: null });
      expect(await withAccountContext(worker, ownerB, (ctx) => new GarminActivitiesRepository(ctx).get(result.id))).toBeNull();
    } finally { await worker.destroy(); }
  });

  async function account() { return (await db.insertInto('accounts').values({ display_name: `Garmin test ${randomUUID()}`, email: null, status: 'active' }).returning('id').executeTakeFirstOrThrow()).id; }
  async function activity(owner: string, time: string, distance: number) {
    return withAccountContext(db, owner, async (ctx) => (await ctx.insertInto('activities').values({ source: 'manual', activity_type: 'run', subtype: 'outdoor', start_time: new Date(time), activity_date: time.slice(0, 10), duration_s: 1800, moving_time_s: 1750, distance_m: distance }).returning('id').executeTakeFirstOrThrow()).id);
  }
  async function canonicalRows(owner: string) {
    return withAccountContext(db, owner, async (ctx) => ({ activities: await ctx.selectFrom('activities').selectAll().orderBy('id').execute(), scores: await ctx.selectFrom('daily_metrics').selectAll().execute(), ledger: await ctx.selectFrom('score_ledger').selectAll().execute() }));
  }
  async function strava(owner: string, time: string, id: string) {
    return withAccountContext(db, owner, async (ctx) => {
      let connection = await ctx.selectFrom('provider_connections').select('id').executeTakeFirst();
      connection ??= await ctx.insertInto('provider_connections').values({ provider: 'strava', provider_account_id: `test-${randomUUID()}`, display_name: null, scopes: [], status: 'connected', access_expires_at: null, cursor_json: {} }).returning('id').executeTakeFirstOrThrow();
      const batch = await ctx.insertInto('import_batches').values({ source: 'strava_api', source_kind: 'strava', filename: null, original_sha256: null, status: 'started', completed_at: null, metadata: {} }).returning('id').executeTakeFirstOrThrow();
      return new ProvidersRepository(ctx).ingestActivitySnapshot({ batchId: batch.id, connectionId: connection.id, providerActivityId: id, providerUpdatedAt: null, identityFingerprint: createHash('sha256').update(id).digest('hex'), rawHash: 'c'.repeat(64), raw: { id }, activity: { activityDate: time.slice(0, 10), startTime: new Date(time), activityType: 'run', subtype: 'outdoor', distanceM: 5200, durationS: 1800, movingTimeS: 1750, calories: null, avgHr: null, maxHr: null, elevationGainM: null, avgSpeedMps: null, avgPaceSPerKm: null, notes: null } });
    });
  }
});
