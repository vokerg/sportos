import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { ActivitiesRepository } from './activities.repository.js';

const url = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;
type TestDb = ReturnType<typeof createDb>;

databaseDescribe('activity route provenance and owner isolation', () => {
  let db: TestDb;
  const owners: string[] = [];

  beforeAll(() => { db = createDb(url!); });
  afterAll(async () => {
    for (const owner of owners) {
      await withAccountContext(db, owner, async scoped => {
        await scoped.deleteFrom('provider_activity_links').execute();
        await scoped.deleteFrom('activities').execute();
        await scoped.deleteFrom('source_records').execute();
        await scoped.deleteFrom('import_batches').execute();
        await scoped.deleteFrom('provider_connections').execute();
      });
    }
    if (owners.length) await db.deleteFrom('accounts').where('id', 'in', owners).execute();
    await db.destroy();
  });

  it('uses only current linked Strava snapshots and hides foreign/unknown activity IDs', async () => {
    const ownerA = await account(db);
    const ownerB = await account(db);
    owners.push(ownerA, ownerB);
    const polyline = '_p~iF~ps|U_ulLnnqC_mqNvxq' + String.fromCharCode(96) + '@';
    const fixture = await withAccountContext(db, ownerA, async scoped => {
      const connectionId = (await scoped.insertInto('provider_connections').values({
        provider: 'strava', provider_account_id: 'athlete-' + randomUUID(),
        display_name: null, scopes: ['activity:read_all'], status: 'connected',
        access_expires_at: null, cursor_json: {},
      }).returning('id').executeTakeFirstOrThrow()).id;
      const batch = (await scoped.insertInto('import_batches').values({
        source: 'strava_api', source_kind: 'strava', filename: null,
        original_sha256: null, status: 'normalized', completed_at: null, metadata: {},
      }).returning('id').executeTakeFirstOrThrow()).id;
      const source = (await scoped.insertInto('source_records').values({
        import_batch_id: batch, source: 'strava_api', sheet_name: null, row_index: null,
        source_record_key: 'strava-test-' + randomUUID(), row_hash: 'a'.repeat(64),
        raw_json: { map: { summary_polyline: polyline } },
        normalized_entity_type: null, normalized_entity_id: null,
        status: 'normalized', errors: [], warnings: [],
      }).returning(['id', 'source_record_key']).executeTakeFirstOrThrow());
      const activity = (await scoped.insertInto('activities').values({
        source: 'manual', activity_type: 'run', activity_date: '2095-05-01',
        source_record_id: source.id,
      }).returning('id').executeTakeFirstOrThrow()).id;
      const unlinked = (await scoped.insertInto('activities').values({
        source: 'manual', activity_type: 'walk', activity_date: '2095-05-02',
        source_record_id: source.id,
      }).returning('id').executeTakeFirstOrThrow()).id;
      await scoped.updateTable('source_records')
        .set({ normalized_entity_type: 'activity', normalized_entity_id: activity })
        .where('id', '=', source.id).execute();
      const link = (await scoped.insertInto('provider_activity_links').values({
        connection_id: connectionId, provider_activity_id: source.source_record_key!,
        activity_id: activity, latest_source_record_id: source.id,
        identity_fingerprint: 'b'.repeat(64), fingerprint_version: 1,
        availability: 'available', provider_updated_at: null,
      }).returning('id').executeTakeFirstOrThrow()).id;
      return { activity, unlinked, sourceId: source.id, link, polyline };
    });
    const read = (owner: string, activity: string) => withAccountContext(db, owner, scoped =>
      new ActivitiesRepository(scoped).getStravaRouteEvidence(activity));

    expect(await read(ownerA, fixture.activity)).toEqual({
      linked: true, polyline: fixture.polyline, polylineType: 'string',
    });
    expect(await read(ownerA, fixture.unlinked)).toEqual({ linked: false, polyline: null, polylineType: null });
    expect(await read(ownerB, fixture.activity)).toBeNull();
    expect(await read(ownerA, randomUUID())).toBeNull();

    // Even a linked source with matching native ID is untrusted if its
    // normalization no longer refers to this canonical activity.
    await withAccountContext(db, ownerA, scoped =>
      scoped.updateTable('source_records').set({ normalized_entity_id: fixture.unlinked })
        .where('id', '=', fixture.sourceId).execute());
    expect(await read(ownerA, fixture.activity)).toEqual({ linked: false, polyline: null, polylineType: null });

    await withAccountContext(db, ownerA, scoped =>
      scoped.updateTable('source_records').set({ normalized_entity_id: fixture.activity, status: 'raw' })
        .where('id', '=', fixture.sourceId).execute());
    expect(await read(ownerA, fixture.activity)).toEqual({ linked: false, polyline: null, polylineType: null });

    await withAccountContext(db, ownerA, scoped =>
      scoped.updateTable('source_records').set({ status: 'normalized' })
        .where('id', '=', fixture.sourceId).execute());
    expect(await read(ownerA, fixture.activity)).toMatchObject({ linked: true, polylineType: 'string' });

    await withAccountContext(db, ownerA, scoped =>
      scoped.updateTable('source_records').set({ raw_json: { map: { summary_polyline: ['wrong type'] } } })
        .where('id', '=', fixture.sourceId).execute());
    expect(await read(ownerA, fixture.activity)).toMatchObject({ linked: true, polylineType: 'array' });

    await withAccountContext(db, ownerA, scoped =>
      scoped.updateTable('provider_activity_links').set({ availability: 'deleted' }).where('id', '=', fixture.link).execute());
    expect(await read(ownerA, fixture.activity)).toEqual({ linked: false, polyline: null, polylineType: null });
  });
});

async function account(db: TestDb) {
  return (await db.insertInto('accounts').values({
    display_name: 'Route ' + randomUUID(), email: null, status: 'active',
  }).returning('id').executeTakeFirstOrThrow()).id;
}
