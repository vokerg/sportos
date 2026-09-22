import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import type { Database } from '../schema.js';
import type { Kysely } from 'kysely';
import { ActivitiesRepository } from './activities.repository.js';
import {
  ActivityProviderResourcesRepository,
  type ActivityProviderReference,
} from './activity-provider-resources.repository.js';

const databaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const activityDetailDatabaseUrl = process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl && activityDetailDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

databaseDescribe('activity provider resource cache', () => {
  let db: TestDatabase;
  let detailDb: TestDatabase;
  const owners: string[] = [];

  beforeAll(() => {
    db = createDb(databaseUrl!);
    detailDb = createDb(activityDetailDatabaseUrl!);
  });
  afterAll(async () => {
    for (const owner of owners) {
      await withAccountContext(detailDb, owner, (scoped) =>
        scoped.deleteFrom('activity_provider_resources').execute());
      await withAccountContext(db, owner, async (scoped) => {
        await scoped.deleteFrom('provider_activity_links').execute();
        await scoped.deleteFrom('source_records').execute();
        await scoped.deleteFrom('activities').execute();
        await scoped.deleteFrom('import_batches').execute();
        await scoped.deleteFrom('provider_connections').execute();
      });
    }
    if (owners.length) await db.deleteFrom('accounts').where('id', 'in', owners).execute();
    await db.destroy();
    await detailDb.destroy();
  });

  it('isolates owners, versions by source hash, and never reuses another provider activity cache', async () => {
    const ownerA = await account(db);
    const ownerB = await account(db);
    owners.push(ownerA, ownerB);

    const fixture = await withAccountContext(db, ownerA, async (scoped) => {
      const connectionId = (await scoped.insertInto('provider_connections').values({
        provider: 'strava',
        provider_account_id: `athlete-${randomUUID()}`,
        display_name: 'Athlete A',
        scopes: ['activity:read_all'],
        status: 'connected',
        access_expires_at: null,
        cursor_json: {},
      }).returning('id').executeTakeFirstOrThrow()).id;
      const batchId = (await scoped.insertInto('import_batches').values({
        source: 'strava_api',
        source_kind: 'strava',
        filename: null,
        original_sha256: null,
        status: 'normalized',
        completed_at: null,
        metadata: {},
      }).returning('id').executeTakeFirstOrThrow()).id;
      const activityId = (await scoped.insertInto('activities').values({
        source: 'manual',
        activity_type: 'run',
        activity_date: '2095-04-01',
        distance_m: 5000,
      }).returning('id').executeTakeFirstOrThrow()).id;
      const sourceA = await source(scoped, batchId, 'provider-a', 'a'.repeat(64));
      const sourceB = await source(scoped, batchId, 'provider-b', 'b'.repeat(64));
      const linkA = (await scoped.insertInto('provider_activity_links').values({
        connection_id: connectionId,
        provider_activity_id: 'provider-a',
        activity_id: activityId,
        latest_source_record_id: sourceA,
        identity_fingerprint: '1'.repeat(64),
        fingerprint_version: 1,
        availability: 'available',
        provider_updated_at: null,
      }).returning('id').executeTakeFirstOrThrow()).id;
      const linkB = (await scoped.insertInto('provider_activity_links').values({
        connection_id: connectionId,
        provider_activity_id: 'provider-b',
        activity_id: activityId,
        latest_source_record_id: sourceB,
        identity_fingerprint: '2'.repeat(64),
        fingerprint_version: 1,
        availability: 'available',
        provider_updated_at: null,
      }).returning('id').executeTakeFirstOrThrow()).id;
      await scoped.updateTable('provider_activity_links').set({ updated_at: new Date('2095-04-01T10:00:00Z') }).where('id', '=', linkA).execute();
      await scoped.updateTable('provider_activity_links').set({ updated_at: new Date('2095-04-01T11:00:00Z') }).where('id', '=', linkB).execute();
      return { activityId, linkA, linkB };
    });

    const referenceB = await withAccountContext(db, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).getProviderReference(fixture.activityId));
    expect(referenceB).toMatchObject({
      providerActivityId: 'provider-b',
      providerVersion: 'b'.repeat(64),
    });
    expect(await withAccountContext(db, ownerA, (scoped) =>
      new ActivitiesRepository(scoped).get(fixture.activityId))).toMatchObject({
      providerDetail: { provider: 'strava', providerActivityId: 'provider-b' },
    });

    const referenceA: ActivityProviderReference = {
      ...referenceB!,
      providerActivityId: 'provider-a',
      providerVersion: 'a'.repeat(64),
    };
    await withAccountContext(detailDb, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).replace(referenceA, resources('a')));
    expect(await withAccountContext(detailDb, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).list(referenceB!))).toEqual([]);

    await withAccountContext(detailDb, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).replace(referenceB!, resources('b')));
    expect((await withAccountContext(detailDb, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).list(referenceA)))[0]?.payload).toEqual({ marker: 'a', resourceType: 'detail' });
    expect((await withAccountContext(detailDb, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).list(referenceB!)))[0]?.payload).toEqual({ marker: 'b', resourceType: 'detail' });

    expect(await withAccountContext(db, ownerB, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).getProviderReference(fixture.activityId))).toBeNull();
    expect(await withAccountContext(detailDb, ownerB, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).list(referenceB!))).toEqual([]);

    await withAccountContext(db, ownerA, (scoped) =>
      scoped.updateTable('provider_activity_links').set({ availability: 'inaccessible' }).where('id', '=', fixture.linkB).execute());
    expect(await withAccountContext(db, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).getProviderReference(fixture.activityId))).toMatchObject({
      providerActivityId: 'provider-a',
    });
    expect(await withAccountContext(db, ownerA, (scoped) =>
      new ActivitiesRepository(scoped).get(fixture.activityId))).toMatchObject({
      providerDetail: { provider: 'strava', providerActivityId: 'provider-a' },
    });

    await withAccountContext(db, ownerA, (scoped) =>
      scoped.updateTable('provider_activity_links').set({ availability: 'deleted' }).where('id', '=', fixture.linkA).execute());
    expect(await withAccountContext(db, ownerA, (scoped) =>
      new ActivityProviderResourcesRepository(scoped).getProviderReference(fixture.activityId))).toBeNull();
    expect(await withAccountContext(db, ownerA, (scoped) =>
      new ActivitiesRepository(scoped).get(fixture.activityId))).toMatchObject({ providerDetail: null });
  });
});

async function account(db: TestDatabase) {
  return (await db.insertInto('accounts').values({
    display_name: `Provider cache ${randomUUID()}`,
    email: null,
    status: 'active',
  }).returning('id').executeTakeFirstOrThrow()).id;
}

async function source(
  db: Kysely<Database>,
  batchId: string,
  key: string,
  rowHash: string,
): Promise<string> {
  return (await db.insertInto('source_records').values({
    import_batch_id: batchId,
    source: 'strava_api',
    sheet_name: null,
    row_index: null,
    source_record_key: key,
    row_hash: rowHash,
    raw_json: { id: key },
    normalized_entity_type: 'activity',
    normalized_entity_id: null,
    status: 'normalized',
    errors: [],
    warnings: [],
  }).returning('id').executeTakeFirstOrThrow()).id;
}

function resources(marker: string) {
  return ['detail', 'streams', 'laps', 'zones'].map((resourceType) => ({
    resourceType: resourceType as 'detail' | 'streams' | 'laps' | 'zones',
    availability: 'available' as const,
    httpStatus: 200,
    payload: { marker, resourceType },
  }));
}
