import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { estimateStravaEfforts } from '@sportos/domain';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import type { Database, Json } from '../schema.js';
import { ActivityMetricsRepository } from './activity-metrics.repository.js';
import { RunningEffortsRepository } from './running-efforts.repository.js';
import { ActivitiesRepository } from './activities.repository.js';
import { GarminActivitiesRepository } from './garmin-activities.repository.js';
import { ActivityProviderResourcesRepository } from './activity-provider-resources.repository.js';
import { GarminActivityResourcesRepository } from './garmin-activity-resources.repository.js';
import { RetainedRunningEffortProjector, effortInspectionTime } from '../running-effort-projector.js';
import { backfillRetainedRunningEfforts } from '../running-effort-backfill.js';
const primaryUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL, detailUrl = process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
const integration = primaryUrl && detailUrl ? describe : describe.skip;
integration('running efforts retained-only non-owner primary/detail integration', () => {
  let primary: Kysely<Database>, detail: Kysely<Database>, owner: string, foreign: string;
  const scoped = <T>(fn: (db: Kysely<Database>) => Promise<T>, account = owner) => withAccountContext(primary, account, fn);
  const rich = <T>(fn: (db: Kysely<Database>) => Promise<T>, account = owner) => withAccountContext(detail, account, fn);
  const project = (id: string, dry = false, provider?: 'strava' | 'garmin') => scoped(db => new RetainedRunningEffortProjector(db, fn => rich(fn)).project(id, dry, provider));
  const read = (id: string, account = owner) => scoped(db => new RunningEffortsRepository(db).read(id), account);
  beforeAll(async () => {
    primary = createDb(primaryUrl!); detail = createDb(detailUrl!);
    for (const db of [primary, detail]) expect((await sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(db)).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    owner = (await primary.insertInto('accounts').values({ display_name: 'Synthetic efforts', email: null, status: 'active' }).returning('id').executeTakeFirstOrThrow()).id;
    foreign = (await primary.insertInto('accounts').values({ display_name: 'Synthetic isolation', email: null, status: 'active' }).returning('id').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => { await primary?.destroy(); await detail?.destroy(); vi.restoreAllMocks(); });
  async function fixture(distance = 10000, moving = 3000, sport: 'run' | 'bike' = 'run', rawInput?: Json) {
    return scoped(async db => {
      const native = String(Math.floor(Math.random() * 1e12)), raw = rawInput ?? { distance, moving_time: moving, elapsed_time: moving, id: Number(native) };
      const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
      const connection = (await db.selectFrom('provider_connections').select('id').where('provider', '=', 'strava').executeTakeFirst())?.id ?? (await db.insertInto('provider_connections').values({ provider: 'strava', provider_account_id: randomUUID(), display_name: null, scopes: [], status: 'connected', access_expires_at: null, cursor_json: {} }).returning('id').executeTakeFirstOrThrow()).id;
      const batch = (await db.insertInto('import_batches').values({ source: 'strava_api', source_kind: 'strava', filename: null, original_sha256: null, status: 'normalized', completed_at: null, metadata: {} }).returning('id').executeTakeFirstOrThrow()).id;
      const source = (await db.insertInto('source_records').values({ import_batch_id: batch, source: 'strava_api', sheet_name: null, row_index: null, source_record_key: native, row_hash: hash, raw_json: raw, normalized_entity_type: null, normalized_entity_id: null, status: 'raw', errors: [], warnings: [] }).returning('id').executeTakeFirstOrThrow()).id;
      const start = new Date(Date.UTC(2095, 0, 1) + Math.floor(Math.random() * 1e7) * 1000);
      const activity = (await db.insertInto('activities').values({ source: 'strava', source_record_id: source, source_activity_id: native, activity_type: sport, subtype: 'outdoor', activity_date: '2095-01-01', start_time: start, distance_m: distance, duration_s: moving, moving_time_s: moving }).returning('id').executeTakeFirstOrThrow()).id;
      const link = (await db.insertInto('provider_activity_links').values({ connection_id: connection, provider_activity_id: native, activity_id: activity, latest_source_record_id: source, identity_fingerprint: hash, fingerprint_version: 1, availability: 'available', provider_updated_at: null }).returning('id').executeTakeFirstOrThrow()).id;
      return { activity, native, hash, source, batch, link, connection, start, distance, moving };
    });
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function stream(distance = 10000, pace = .28): Json {
    const d = Array.from({ length: Math.floor(distance / 10) + 1 }, (_, i) => i * 10);
    return { time: { data: d.map(v => v * pace), series_type: 'distance', resolution: 'high', original_size: d.length }, distance: { data: d, series_type: 'distance', resolution: 'high', original_size: d.length }, moving: { data: d.map(() => true), series_type: 'distance', resolution: 'high', original_size: d.length } };
  }
  async function strava(f: Fixture, payload = stream(), version = f.hash) {
    await rich(db => new ActivityProviderResourcesRepository(db).replace({ activityId: f.activity, provider: 'strava', providerActivityId: f.native, connectionId: f.connection, providerVersion: version }, [{ resourceType: 'streams', availability: 'available', httpStatus: 200, payload }]));
  }
  async function garmin(f: Fixture, distance = 10000, seconds = 3000, pauseEvents = true, stoppedDrift = 0) {
    const native = String(Math.floor(Math.random() * 1e12)), hash = createHash('sha256').update(native).digest('hex');
    const identity = await scoped(db => new GarminActivitiesRepository(db).ingest({ provider: 'garmin', providerActivityId: native, contentHash: hash, origin: 'connect', sourceUpdatedAt: f.start,
      summary: { activityType: 'run', subtype: 'outdoor', startTime: f.start, elapsedTimeS: f.moving, movingTimeS: f.moving, distanceM: distance } }));
    expect(identity.activityId).toBe(f.activity);
    const ts = (s: number) => new Date(f.start.getTime() + s * 1000).toISOString();
    const message = (name: string, fields: Record<string, unknown>) => ({ message: name, fields: Object.entries(fields).map(([name, value]) => ({ name, units: name === 'distance' ? 'm' : name === 'timestamp' ? 's' : null, value: value as Json, definition: 0, developerIndex: null, rawValue: value as Json })) });
    const stop = seconds / 2;
    const records: Json[] = [message('session', {}), ...(pauseEvents ? [message('event', { timestamp: ts(0), event: 'timer', event_type: 'start' }),
      ...(stoppedDrift ? [message('event', { timestamp: ts(stop), event: 'timer', event_type: 'stop' }), message('event', { timestamp: ts(stop + 60), event: 'timer', event_type: 'start' })] : []),
      message('event', { timestamp: ts(seconds + (stoppedDrift ? 60 : 0)), event: 'timer', event_type: 'stop_all' })] : []),
      ...Array.from({ length: Math.floor(distance / 10) + 1 }, (_, i) => {
        const t = i * seconds / (distance / 10), after = stoppedDrift && t > stop;
        return [message('record', { timestamp: ts(t + (after ? 60 : 0)), distance: i * 10 + (after ? stoppedDrift : 0) }),
          ...(stoppedDrift && t === stop ? [message('record', { timestamp: ts(stop + 60), distance: i * 10 + stoppedDrift })] : [])];
      }).flat()];
    await rich(async db => {
      const repo = new GarminActivityResourcesRepository(db), ref = { identityKey: `native:${native}`, sourceHash: hash };
      await repo.retain(ref, { resourceType: 'detail', chunkIndex: 0, payload: {} }); await repo.retain(ref, { resourceType: 'sets', chunkIndex: 0, payload: {} });
      await repo.retain(ref, { resourceType: 'records', chunkIndex: 0, payload: records });
      await repo.retain(ref, { resourceType: 'fit_manifest', chunkIndex: 0, payload: { expectedResources: ['detail', 'sets', 'records'].map(resourceType => ({ resourceType, chunkIndex: 0 })) } });
    });
    return { native, hash, identity };
  }
  const facts = () => scoped(async db => ({ activities: await db.selectFrom('activities').selectAll().orderBy('id').execute(), daily: await db.selectFrom('daily_metrics').selectAll().execute(), ledger: await db.selectFrom('score_ledger').selectAll().execute(), snapshots: await db.selectFrom('daily_score_snapshots').selectAll().execute(), performance: await db.selectFrom('performance_events').selectAll().execute() }));
  it('persists a transparent summary estimate, upgrades streams independently and converges unchanged work', async () => {
    const f = await fixture(); expect((await read(f.activity)).providers[0].state).toBe('unprocessed');
    await scoped(async db => {
      await sql`select sportos_seed_account_rules(${owner}::uuid)`.execute(db);
      await db.insertInto('daily_metrics').values({ metric_date:'2095-01-01',source_record_id:f.source,steps:12345,run_m:10000,bike_m:0,swim_m:0,workout_points:0,base_points:1234,bonus_points:0,total_points:1234,excel_all_points:null,excel_row_hash:null }).execute();
      const rule=await db.selectFrom('scoring_rules').select('id').where('code','=','run.km.default').executeTakeFirstOrThrow();
      await db.insertInto('score_ledger').values({ metric_date:'2095-01-01',activity_id:f.activity,rule_id:rule.id,points:1234,reason:'Synthetic integrity fixture',calculation_json:{distance:10000} }).execute();
      await db.insertInto('daily_score_snapshots').values({ metric_date:'2095-01-01',score_status:'calculated',base_points:1234,bonus_points:0,total_points:1234,facts_json:{steps:12345,runM:10000},ledger_json:sql<Json>`'[]'::jsonb`,source_record_id:f.source,trigger:'manual_recalculation' }).execute();
      await db.insertInto('performance_events').values({ activity_id:f.activity,source_record_id:f.source,source_record_hash:null,source:'run_db_xlsx',event_date:'2095-01-01',distance_m:5000,duration_s:1400,pace_s_per_km:280,is_treadmill:false,is_race:false,is_pr_marker:false,source_rank:null,tags:[],notes:null,raw_payload_json:{} }).execute();
    });
    const before = await facts(); expect((await project(f.activity))[0].category).toBe('newly_projected');
    expect((await read(f.activity)).providers[0].efforts[0]).toMatchObject({ status: 'estimated', durationS: 1500, startOffsetS: null });
    await strava(f); await project(f.activity, false, 'strava');
    expect((await read(f.activity)).providers[0].efforts[0]).toMatchObject({ status: 'calculated', startOffsetS: 0 });
    const heads = await scoped(db => db.selectFrom('running_effort_heads').selectAll().where('activity_id', '=', f.activity).execute());
    expect((await project(f.activity))[0].category).toBe('already_current');
    expect(await scoped(db => db.selectFrom('running_effort_heads').selectAll().where('activity_id', '=', f.activity).execute())).toEqual(heads);
    expect(await facts()).toEqual(before);
    const response = await scoped(db => new ActivitiesRepository(db).get(f.activity)); expect(response?.bestEfforts).toEqual(await read(f.activity));
    expect(JSON.stringify(response?.bestEfforts)).not.toContain(f.hash); expect(JSON.stringify(response?.bestEfforts)).not.toContain(owner);
  });
  it('uses only exact source-backed canonical summary fallback and never borrows manual/workbook facts',async()=>{
    const f=await fixture(10000,3000,'run',{});await project(f.activity);
    expect((await read(f.activity))!.providers[0].efforts[0]).toMatchObject({status:'estimated',durationS:1500});
    await scoped(db=>db.updateTable('activities').set({source:'my_sport_xlsx'}).where('id','=',f.activity).execute());await project(f.activity);
    expect((await read(f.activity))!.providers[0].efforts[0]).toMatchObject({status:'unavailable',reason:'missing_or_invalid_strava_summary'});
    const invalid=await fixture(10000,3000,'run',{distance:10000,moving_time:0});await project(invalid.activity);
    expect((await read(invalid.activity))!.providers[0].efforts[0].status).toBe('unavailable');
  });
  it('retains both-provider disagreement without cross-source computation or writes', async () => {
    const f = await fixture(); await strava(f); await garmin(f, 10000, 2960);
    const before = await facts(); const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    await project(f.activity); const response = await read(f.activity);
    expect(response.providers[0].efforts[0].durationS).toBeCloseTo(1400); expect(response.providers[1].efforts[0].durationS).toBeCloseTo(1480);
    expect(response.providers.map(p => p.efforts[0].method)).toEqual(['stream_calculated', 'fit_calculated']);
    await strava(f, stream(10000, .27)); await project(f.activity, false, 'strava');
    expect((await read(f.activity)).providers[0].efforts[0].durationS).toBeCloseTo(1350); expect((await read(f.activity)).providers[1].efforts[0].durationS).toBeCloseTo(1480);
    expect(await facts()).toEqual(before); expect(network).not.toHaveBeenCalled(); network.mockRestore();
  });
  it('marks stale source versions and never disguises invalid/stale rich inputs as measured', async () => {
    const f = await fixture(); await strava(f, stream(), 'e'.repeat(64)); await project(f.activity);
    expect((await read(f.activity)).providers[0].efforts[0]).toMatchObject({ status: 'estimated', reason: 'stale_streams' });
    await strava(f, { time: { data: [0, 10] }, distance: { data: [0, 5000] }, moving: { data: [true, true] } }); await project(f.activity);
    expect((await read(f.activity)).providers[0].efforts[0]).toMatchObject({ status: 'estimated', reason: 'implausible_distance_jump' });
    await scoped(async db => {
      const source = await db.insertInto('source_records').values({ import_batch_id: f.batch, source: 'strava_api', sheet_name: null, row_index: null, source_record_key: f.native, row_hash: 'c'.repeat(64), raw_json: { distance: 9000, moving_time: 2900 }, normalized_entity_type: null, normalized_entity_id: null, status: 'raw', errors: [], warnings: [] }).returning('id').executeTakeFirstOrThrow();
      await db.updateTable('provider_activity_links').set({ latest_source_record_id: source.id }).where('id', '=', f.link).execute();
    });
    expect((await read(f.activity)).providers[0]).toMatchObject({ state: 'stale', efforts: [expect.objectContaining({ durationS: null }), ...Array(5).fill(expect.anything())] });
    await project(f.activity); expect((await read(f.activity)).providers[0].efforts[0]).toMatchObject({ status: 'estimated', durationS: 5000 * 2900 / 9000 });
  });
  it('projects retained paused-distance streams and FIT as calculated without network or official writes', async () => {
    const f = await fixture();
    const d = Array.from({ length: 1001 }, (_, i) => i * 10);
    await strava(f, {
      time: { data: [...d.slice(0, 501).map(v => v * .3), 1560, ...d.slice(501).map(v => v * .3 + 60)] },
      distance: { data: [...d.slice(0, 501), 5000.7, ...d.slice(501).map(v => v + .7)] },
      moving: { data: [...d.slice(0, 500).map(() => true), false, false, ...d.slice(501).map(() => true)] },
    });
    await garmin(f, 10000, 3000, true, 1.05);
    const before = await facts(), network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden'));
    expect((await project(f.activity)).map(r => r.category)).toEqual(['newly_projected', 'newly_projected']);
    const response = await read(f.activity);
    for (const provider of response.providers) {
      expect(provider).toMatchObject({ state: 'current', algorithmVersion: 3 });
      expect(provider.efforts[1]).toMatchObject({ status: 'calculated', durationS: 3000, coverageDistanceM: 10000, endOffsetS: 3060 });
    }
    expect(response.providers.map(p => p.efforts[1].sourceDistanceM)).toEqual([10000.7, 10001.05]);
    expect((await project(f.activity)).every(r => r.category === 'already_current')).toBe(true);
    expect(await read(f.activity)).toEqual(response); expect(await facts()).toEqual(before);
    expect(network).not.toHaveBeenCalled(); network.mockRestore();
  });
  it('requires FIT pause evidence and skips rich reads for unchanged or short Garmin inputs', async () => {
    const f = await fixture(5000, 1500); await garmin(f, 5000, 1500, false); await project(f.activity);
    expect((await read(f.activity)).providers[1].efforts[0]).toMatchObject({ status: 'unavailable', reason: 'insufficient_pause_evidence' });
    const detailCalls = vi.fn(<T>(fn: (db: Kysely<Database>) => Promise<T>) => rich(fn));
    await scoped(db => new RetainedRunningEffortProjector(db, detailCalls).project(f.activity, false, 'garmin'));
    expect(detailCalls).toHaveBeenCalledTimes(1); // signatures only, no chunks
    const short = await fixture(4000, 1200); await garmin(short, 4000, 1200);
    detailCalls.mockClear(); await scoped(db => new RetainedRunningEffortProjector(db, detailCalls).project(short.activity, false, 'garmin'));
    expect(detailCalls).toHaveBeenCalledTimes(1); expect((await read(short.activity)).providers[1].efforts[0].reason).toBe('too_short');
  });
  it('keeps measured continuous targets distinct from summary estimates across stream gaps', async () => {
    const f = await fixture(), d = Array.from({ length: 1001 }, (_, i) => i * 10);
    const moving = d.map(() => true); moving[501] = false;
    await strava(f, { time: { data: d.map(v => v * .28 + (v > 5000 ? 600 : 0)) }, distance: { data: d }, moving: { data: moving } });
    await project(f.activity);
    const provider = (await read(f.activity)).providers[0];
    expect(provider.efforts[0]).toMatchObject({ status: 'calculated', method: 'stream_calculated', reason: 'partial_stream_coverage', coverageDistanceM: 5000 });
    expect(provider.efforts[0].durationS).toBeCloseTo(1400);
    expect(provider.efforts[1]).toMatchObject({ status: 'estimated', method: 'summary_estimate', reason: 'unknown_recording_gap', durationS: 3000, startOffsetS: null });
    await expect(scoped(async db => new RunningEffortsRepository(db).publish({
      reference: (await new ActivityMetricsRepository(db).references([f.activity]))[0], inputHash: 'b'.repeat(64), inspectedAt: await effortInspectionTime(db),
      efforts: provider.efforts.map(e => e.status === 'calculated' ? { ...e, reason: 'unknown_recording_gap' } : e),
    }))).rejects.toThrow('running_effort_values_quality_check');
    expect((await read(f.activity)).providers[0]).toEqual(provider);
  });
  it('keeps historical success on partial read failure but hides its duration; retry recovers idempotently', async () => {
    const f = await fixture(); await strava(f); await project(f.activity);
    const previous = (await read(f.activity)).providers[0].projectedAt;
    const failed = await scoped(db => new RetainedRunningEffortProjector(db, async () => { throw new Error('private source/path'); }).project(f.activity));
    expect(failed[0]).toMatchObject({ category: 'errors', reasons: ['retained_read_failed'] });
    expect((await read(f.activity)).providers[0]).toMatchObject({ state: 'failed', projectedAt: previous }); expect((await read(f.activity)).providers[0].efforts[0].durationS).toBeNull();
    await project(f.activity); expect((await read(f.activity)).providers[0].state).toBe('current');
    expect((await read(f.activity)).providers[0].projectedAt).toBe(previous);
  });
  it('rejects older inspections and changed refs under the reconciliation lock', async () => {
    const f = await fixture(); await project(f.activity);
    const reference = (await scoped(db => new ActivityMetricsRepository(db).references([f.activity])))[0];
    await scoped(db => db.updateTable('running_effort_heads').set({ inspected_at: '2099-01-01 00:00:00.123987+00' }).where('activity_id', '=', f.activity).execute());
    const write = { reference, inputHash: 'b'.repeat(64), inspectedAt: '2099-01-01 00:00:00.123456+00', efforts: estimateStravaEfforts(10000, 3000) };
    expect(await scoped(db => new RunningEffortsRepository(db).publish(write))).toBe('stale');
    expect(await scoped(db => new RunningEffortsRepository(db).publish({ ...write, inspectedAt: '2100-01-01', reference: { ...reference, sourceVersion: 'd'.repeat(64) } }))).toBe('stale');
    await scoped(db => db.updateTable('running_effort_heads').set({ inspected_at: new Date(0) }).where('activity_id', '=', f.activity).execute());
  });
  it('supports bounded dry-run/apply/replay/resume, safe failure cursors and no non-running projections', async () => {
    const before = await scoped(db => db.selectFrom('running_effort_heads').selectAll().orderBy('activity_id').execute());
    const dry = await scoped(db => backfillRetainedRunningEfforts(db, fn => rich(fn), { limit: 1, dryRun: true }));
    expect(dry.processedActivities).toBe(1); expect(dry.hasMore).toBe(true);
    expect(await scoped(db => db.selectFrom('running_effort_heads').selectAll().orderBy('activity_id').execute())).toEqual(before);
    const applied = await scoped(db => backfillRetainedRunningEfforts(db, fn => rich(fn), { limit: 1, dryRun: false }));
    const replay = await scoped(db => backfillRetainedRunningEfforts(db, fn => rich(fn), { limit: 1, dryRun: false }));
    expect(replay.nextCursor).toBe(applied.nextCursor); expect(replay.providers.strava.newly_projected + replay.providers.garmin.newly_projected).toBe(0);
    const next = await scoped(db => backfillRetainedRunningEfforts(db, fn => rich(fn), { limit: 1, dryRun: false, cursor: applied.nextCursor! })); expect(next.nextCursor! > applied.nextCursor!).toBe(true);
    const fail = await scoped(db => backfillRetainedRunningEfforts(db, async () => { throw new Error('private'); }, { limit: 1, dryRun: true }));
    expect(fail.nextCursor).toBeNull(); expect(fail.providers.strava.errors).toBe(1); expect(JSON.stringify(fail)).not.toContain('private'); expect(fail.fetched).toBe(false);
    expect(await project((await fixture(10000, 3000, 'bike')).activity)).toEqual([]);
  });
  it('isolates both databases, enforces same-owner references/history and denies the dispatcher', async () => {
    const f = await fixture(); await strava(f); await project(f.activity);
    expect(await scoped(db => new ActivitiesRepository(db).get(f.activity), foreign)).toBeNull();
    expect(await scoped(db => db.selectFrom('running_effort_values').selectAll().where('activity_id', '=', f.activity).execute(), foreign)).toEqual([]);
    const refs = (await scoped(db => new ActivityMetricsRepository(db).references([f.activity])))[0];
    expect(await rich(db => new ActivityProviderResourcesRepository(db).list({ activityId: f.activity, provider: 'strava', providerActivityId: f.native, connectionId: f.connection, providerVersion: f.hash }), foreign)).toEqual([]);
    const head = await scoped(db => db.selectFrom('running_effort_heads').selectAll().where('activity_id', '=', f.activity).executeTakeFirstOrThrow());
    await expect(scoped(db => db.updateTable('running_effort_heads').set({ owner_id: foreign }).where('activity_id', '=', f.activity).execute())).rejects.toThrow('immutable');
    await expect(scoped(db => db.deleteFrom('running_effort_projections').where('activity_id', '=', f.activity).execute())).rejects.toThrow('permission denied');
    await expect(scoped(db => db.updateTable('running_effort_values').set({ duration_s: 1 }).where('activity_id', '=', f.activity).execute())).rejects.toThrow('permission denied');
    await expect(scoped(db => db.insertInto('running_effort_heads').values({ activity_id: f.activity, provider: 'strava', source_ref: f.link, source_version: f.hash, projection_id: head.projection_id, state: 'current', failure_category: null }).execute(), foreign)).rejects.toThrow();
    await expect(scoped(db => new RunningEffortsRepository(db).publish({ reference: refs, inputHash: 'd'.repeat(64), resourceHash:head.expected_resource_hash, inspectedAt: new Date().toISOString(), efforts: estimateStravaEfforts(10000, 3000).map(e => ({ ...e, durationS: -1 })) }))).rejects.toThrow();
    if (process.env.SPORTOS_WORKER_TEST_DATABASE_URL) { const dispatcher = createDb(process.env.SPORTOS_WORKER_TEST_DATABASE_URL); try { for (const table of ['running_effort_heads', 'running_effort_projections', 'running_effort_values'] as const) await expect(dispatcher.selectFrom(table).selectAll().execute()).rejects.toThrow('permission denied'); } finally { await dispatcher.destroy(); } }
    if (process.env.SPORTOS_WORKER_DATA_TEST_DATABASE_URL) { const worker = createDb(process.env.SPORTOS_WORKER_DATA_TEST_DATABASE_URL); try { expect((await withAccountContext(worker, owner, db => new RunningEffortsRepository(db).read(f.activity))).providers[0].state).toBe('current'); expect(await withAccountContext(worker, foreign, db => db.selectFrom('running_effort_values').selectAll().execute())).toEqual([]); } finally { await worker.destroy(); } }
  });
  it('prevents a read of old mutable streams publishing after a refresh intent', async () => {
    const f=await fixture();await strava(f);await project(f.activity);
    const ref=(await scoped(db=>new ActivityMetricsRepository(db).references([f.activity])))[0];
    await scoped(async db=>new RunningEffortsRepository(db).mark(ref,'stale',await effortInspectionTime(db),null,'e'.repeat(32)));
    // A newer-started reprocess still sees old resources. Expected-content
    // membership rejects it despite the newer timestamp and same summary hash.
    expect((await project(f.activity))[0].category).toBe('stale');
    expect((await read(f.activity))!.providers[0].state).toBe('stale');
    const next=stream(10000,.27);const hash=await scoped(async db=>(await sql<{hash:string}>`select md5(${JSON.stringify(next)}::jsonb::text) as hash`.execute(db)).rows[0].hash);
    await scoped(async db=>new RunningEffortsRepository(db).mark(ref,'stale',await effortInspectionTime(db),null,hash));
    await strava(f,next);await project(f.activity);
    expect((await read(f.activity))!.providers[0].efforts[0].durationS).toBeCloseTo(1350);
  });
  it('hides old algorithm and changed Garmin versions and processes FIT without a Strava link',async()=>{
    const f=await fixture();const g=await garmin(f);await project(f.activity);
    await scoped(async db=>{
      const ref=(await new ActivityMetricsRepository(db).references([f.activity])).find(r=>r.provider==='garmin')!;
      const projection=await db.insertInto('running_effort_projections').values({activity_id:f.activity,provider:'garmin',source_ref:ref.sourceRef,source_version:ref.sourceVersion,input_hash:'f'.repeat(64),resource_hash:null,algorithm_version:1}).returning('id').executeTakeFirstOrThrow();
      await db.updateTable('running_effort_heads').set({projection_id:projection.id}).where('activity_id','=',f.activity).where('provider','=','garmin').execute();
    });
    expect((await read(f.activity))!.providers[1].state).toBe('stale');await project(f.activity,false,'garmin');
    await scoped(db=>db.deleteFrom('provider_activity_links').where('id','=',f.link).execute());
    expect((await read(f.activity))!.providers[0].state).toBe('not_linked');expect((await read(f.activity))!.providers[1].efforts[0].status).toBe('calculated');
    await scoped(db=>new GarminActivitiesRepository(db).ingest({provider:'garmin',providerActivityId:g.native,contentHash:'d'.repeat(64),origin:'connect',sourceUpdatedAt:new Date(f.start.getTime()+1000),summary:{activityType:'run',subtype:'outdoor',startTime:f.start,elapsedTimeS:f.moving,movingTimeS:f.moving,distanceM:f.distance}}));
    expect((await read(f.activity))!.providers[1].state).toBe('stale');await project(f.activity,false,'garmin');
    expect((await read(f.activity))!.providers[1].efforts[0]).toMatchObject({status:'unavailable',reason:'no_fit_records'});
  });
  it('invalidation hides mutable stream results before retention and old history survives canonical deletion', async () => {
    const f = await fixture(); await strava(f); await project(f.activity);
    await scoped(async db => { const ref = (await new ActivityMetricsRepository(db).references([f.activity]))[0]; await new RunningEffortsRepository(db).mark(ref, 'stale', await effortInspectionTime(db)); });
    expect((await read(f.activity)).providers[0].state).toBe('stale'); expect((await read(f.activity)).providers[0].efforts[0].durationS).toBeNull();
    await project(f.activity); await scoped(async db => { await db.deleteFrom('provider_activity_links').where('id', '=', f.link).execute(); await db.deleteFrom('activities').where('id', '=', f.activity).execute(); });
    expect(await scoped(db => db.selectFrom('running_effort_heads').selectAll().where('activity_id', '=', f.activity).execute())).toEqual([]);
    expect(await scoped(db => db.selectFrom('running_effort_projections').selectAll().where('activity_id', '=', f.activity).execute())).toHaveLength(1);
  });
});
