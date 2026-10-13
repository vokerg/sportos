import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { HeatmapRoutesRepository } from './heatmap-routes.repository.js';

const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;
type TestDb = ReturnType<typeof createDb>;
const polyline = '_p~iF~ps|U_ulLnnqC_mqNvxq' + String.fromCharCode(96) + '@';
const newerPolyline = '??A?';

databaseDescribe('owner-scoped heatmap route feed', () => {
  let db: TestDb;
  const owners: string[] = [];
  beforeAll(() => { db = createDb(url!); });
  afterAll(async () => {
    for (const owner of owners) {
      await withAccountContext(db, owner, async scoped => {
        await scoped.deleteFrom('provider_activity_links').execute();
        await scoped.deleteFrom('garmin_activity_identities').execute();
        await scoped.deleteFrom('activities').execute();
        await scoped.deleteFrom('source_records').execute();
        await scoped.deleteFrom('import_batches').execute();
        await scoped.deleteFrom('provider_connections').execute();
      });
    }
    if (owners.length) await db.deleteFrom('accounts').where('id', 'in', owners).execute();
    await db.destroy();
  });

  it('pages distinct canonical linked Strava snapshots, including workbook origins, under forced RLS', async () => {
    const ownerA = await account(db);
    const ownerB = await account(db);
    owners.push(ownerA, ownerB);
    const a = await setup(db, ownerA);
    const b = await setup(db, ownerB);
    const workbook = await seed(db, a, '2095-05-05', 'run', { source: 'my_sport_xlsx' });
    const missing = await seed(db, a, '2095-05-04', 'walk', { geometry: null });
    const invalid = await seed(db, a, '2095-05-03', 'bike', { geometry: ['bad'] });
    const oldest = await seed(db, a, '2095-05-02', 'run');
    const unlinked = await seed(db, a, '2095-05-06', 'run', { linked: false });
    const stale = await seed(db, a, '2095-05-07', 'run', { status: 'raw' });
    const deleted = await seed(db, a, '2095-05-08', 'run', { availability: 'deleted' });
    const foreign = await seed(db, b, '2095-05-09', 'run');

    // The same canonical activity with a second valid Strava identity still
    // occupies one slot; the most recently updated available link wins.
    await seedLink(db, a, workbook, 'different-source', newerPolyline);

    const list = (owner: string, filters: Parameters<HeatmapRoutesRepository['list']>[0]) =>
      withAccountContext(db, owner, scoped => new HeatmapRoutesRepository(scoped).list(filters));

    const first = await list(ownerA, { limit: 2 });
    expect(first.hasMore).toBe(true);
    expect(first.candidates.map(row => row.activityId)).toEqual([workbook, missing]);
    expect(first.candidates[0]).toMatchObject({
      date: '2095-05-05', sport: 'run', polyline: newerPolyline, polylineType: 'string',
    });
    expect(first.candidates[1]).toMatchObject({ polyline: null, polylineType: null });

    const second = await list(ownerA, { limit: 2, cursor: { date: '2095-05-04', id: missing } });
    expect(second.hasMore).toBe(false);
    expect(second.candidates.map(row => row.activityId)).toEqual([invalid, oldest]);
    expect(second.candidates[0]).toMatchObject({ polylineType: 'array' });

    expect((await list(ownerA, { limit: 50, from: '2095-05-04', to: '2095-05-05' }))
      .candidates.map(row => row.activityId)).toEqual([workbook, missing]);
    expect((await list(ownerA, { limit: 50, activityType: 'run' }))
      .candidates.map(row => row.activityId)).toEqual([workbook, oldest]);
    expect((await list(ownerB, { limit: 50 })).candidates.map(row => row.activityId)).toEqual([foreign]);
    expect((await list(ownerB, { limit: 50, cursor: { date: '2095-05-05', id: workbook } })).candidates).toEqual([]);
    expect([unlinked, stale, deleted].some(id => first.candidates.concat(second.candidates)
      .some(row => row.activityId === id))).toBe(false);
    expect(first.candidates[0]).toMatchObject({stravaLinked:true,
      stravaProviderActivityId:expect.any(String),stravaProviderVersion:'a'.repeat(64)});

    // Garmin-only canonical IDs join the same bounded feed. An available Strava
    // link blocks tempting FIT substitution even if its summary lacks GPS.
    const garminOnly = await withAccountContext(db, ownerA, scoped => scoped.insertInto('activities')
      .values({source:'garmin',activity_date:'2095-04-30',activity_type:'run'})
      .returning('id').executeTakeFirstOrThrow()).then(row => row.id);
    await garminLink(db, ownerA, garminOnly);
    await garminLink(db, ownerA, missing);
    const garminPage = await list(ownerA,{limit:50,from:'2095-04-30',to:'2095-05-04'});
    expect(garminPage.candidates.map(c=>c.activityId)).toContain(garminOnly);
    expect(garminPage.candidates.find(c=>c.activityId===garminOnly)).toMatchObject({
      stravaLinked:false,polyline:null,garminIdentityKey:expect.any(String),
      garminCurrentHash:'c'.repeat(64),
    });
    expect(garminPage.candidates.find(c=>c.activityId===missing)).toMatchObject({
      stravaLinked:true,polyline:null,garminIdentityKey:expect.any(String),
    });
    expect((await list(ownerB,{limit:50,from:'2095-04-30',to:'2095-05-04'})).candidates).toEqual([]);

    // Identical calendar days must not duplicate or skip routes across cursor pages.
    const sameDayA = await seed(db, a, '2095-06-01', 'run');
    const sameDayB = await seed(db, a, '2095-06-01', 'walk');
    const sorted = [sameDayA, sameDayB].sort((a, b) => b.localeCompare(a));
    const sameDayFirst = await list(ownerA, { limit: 1, from: '2095-06-01', to: '2095-06-01' });
    expect(sameDayFirst.hasMore).toBe(true);
    expect(sameDayFirst.candidates.map(row => row.activityId)).toEqual([sorted[0]]);
    const sameDaySecond = await list(ownerA, {
      limit: 1, from: '2095-06-01', to: '2095-06-01', cursor: { date: '2095-06-01', id: sorted[0]! },
    });
    expect(sameDaySecond.hasMore).toBe(false);
    expect(sameDaySecond.candidates.map(row => row.activityId)).toEqual([sorted[1]]);

  });
});

async function account(db: TestDb) {
  return (await db.insertInto('accounts').values({
    display_name: 'Heatmap ' + randomUUID(), email: null, status: 'active',
  }).returning('id').executeTakeFirstOrThrow()).id;
}

async function setup(db: TestDb, owner: string) {
  return withAccountContext(db, owner, async scoped => {
    const connection = (await scoped.insertInto('provider_connections').values({
      provider: 'strava', provider_account_id: 'heatmap-' + randomUUID(),
      display_name: null, scopes: ['activity:read_all'], status: 'connected',
      access_expires_at: null, cursor_json: {},
    }).returning('id').executeTakeFirstOrThrow()).id;
    const batch = (await scoped.insertInto('import_batches').values({
      source: 'strava_api', source_kind: 'strava', filename: null,
      original_sha256: null, status: 'normalized', completed_at: null, metadata: {},
    }).returning('id').executeTakeFirstOrThrow()).id;
    return { owner, connection, batch };
  });
}

type Fixture = Awaited<ReturnType<typeof setup>>;
type Geometry = string | null | string[];
async function seed(db: TestDb, fixture: Fixture, date: string, sport: 'run' | 'walk' | 'bike', options: {
  source?: 'my_sport_xlsx';
  geometry?: Geometry;
  linked?: boolean;
  status?: 'normalized' | 'raw';
  availability?: 'available' | 'deleted';
} = {}): Promise<string> {
  return withAccountContext(db, fixture.owner, async scoped => {
    const activity = (await scoped.insertInto('activities').values({
      source: options.source ?? 'strava', activity_type: sport, activity_date: date,
    }).returning('id').executeTakeFirstOrThrow()).id;
    const key = 'heatmap-' + randomUUID();
    const record = (await scoped.insertInto('source_records').values({
      import_batch_id: fixture.batch, source: 'strava_api', sheet_name: null, row_index: null,
      source_record_key: key, row_hash: 'a'.repeat(64),
      raw_json: { map: { summary_polyline: options.geometry === undefined ? polyline : options.geometry } },
      normalized_entity_type: 'activity', normalized_entity_id: activity,
      status: options.status ?? 'normalized', errors: [], warnings: [],
    }).returning('id').executeTakeFirstOrThrow()).id;
    if (options.linked !== false) {
      await scoped.insertInto('provider_activity_links').values({
        connection_id: fixture.connection, provider_activity_id: key,
        activity_id: activity, latest_source_record_id: record,
        identity_fingerprint: 'b'.repeat(64), fingerprint_version: 1,
        availability: options.availability ?? 'available', provider_updated_at: null,
      }).execute();
    }
    return activity;
  });
}

async function seedLink(db: TestDb, fixture: Fixture, activity: string, key: string, geometry: Geometry) {
  return withAccountContext(db, fixture.owner, async scoped => {
    const native = key + randomUUID();
    const record = (await scoped.insertInto('source_records').values({
      import_batch_id: fixture.batch, source: 'strava_api', sheet_name: null, row_index: null,
      source_record_key: native, row_hash: 'a'.repeat(64),
      raw_json: { map: { summary_polyline: geometry } }, normalized_entity_type: 'activity',
      normalized_entity_id: activity, status: 'normalized', errors: [], warnings: [],
    }).returning('id').executeTakeFirstOrThrow()).id;
    await scoped.insertInto('provider_activity_links').values({
      connection_id: fixture.connection, provider_activity_id: native, activity_id: activity,
      latest_source_record_id: record, identity_fingerprint: 'b'.repeat(64),
      fingerprint_version: 1, availability: 'available', provider_updated_at: null,
      updated_at: new Date('2098-01-01T00:00:00Z'),
    }).execute();
  });
}

async function garminLink(db: TestDb, owner: string, activityId: string) {
  await withAccountContext(db, owner, scoped => scoped.insertInto('garmin_activity_identities').values({
    identity_key: 'native:' + randomUUID(), identity_kind: 'native', activity_id: activityId,
    status: 'manual', activity_type: 'run', subtype: null, start_time: new Date('2095-04-30T10:00:00Z'),
    elapsed_time_s: 3600, moving_time_s: 3600, distance_m: 10000,
    current_hash: 'c'.repeat(64), source_updated_at: new Date('2095-04-30T10:00:00Z'),
    match_evidence: {},
  }).execute());
}
