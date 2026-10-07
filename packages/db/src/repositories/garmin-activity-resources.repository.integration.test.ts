import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { GarminActivityResourcesRepository } from './garmin-activity-resources.repository.js';
const url = process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('staged Garmin resources in the separate detail database', () => {
  let db: ReturnType<typeof createDb>;
  beforeAll(() => { db = createDb(url!); });
  afterAll(async () => db?.destroy());
  it('retains before canonical matching, converges duplicates and preserves older source versions', async () => {
    const owner = randomUUID(); const foreign = randomUUID();
    const ref = { identityKey: 'native:12345', sourceHash: 'a'.repeat(64) };
    const resource = { resourceType: 'sets' as const, chunkIndex: 0, payload: { sets: [{ repetitions: 10, weight: 20000, weightUnit: 'grams' }] } };
    const retain = (hash = ref.sourceHash) => withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).retain({ ...ref, sourceHash: hash }, resource));
    expect(await retain()).toBe(true);
    expect(await retain()).toBe(false);
    await withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).retain(ref, { resourceType: 'records', chunkIndex: 0, payload: [{ field: 'synthetic', value: 42 }] }));
    expect(await withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).read(ref, 'records'))).toEqual({ payload: [{ field: 'synthetic', value: 42 }] });
    expect(await retain('b'.repeat(64))).toBe(true);
    expect(await withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).read(ref, 'sets'))).toEqual({ payload: resource.payload });
    expect(await withAccountContext(db, foreign, (ctx) => new GarminActivityResourcesRepository(ctx).read(ref, 'sets'))).toBeNull();
    expect(await withAccountContext(db, foreign, (ctx) => new GarminActivityResourcesRepository(ctx).coverage(ref))).toEqual([]);
    await expect(withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).retain(ref, { ...resource, payload: { sets: [] } }))).rejects.toThrow('conflicts');
    await expect(withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).retain(ref, { ...resource, payload: 'x'.repeat(4_000_001) }))).rejects.toThrow('bounded');
    await expect(withAccountContext(db, owner, (ctx) => ctx.updateTable('garmin_activity_resources').set({ payload_json: {} }).execute())).rejects.toThrow('permission denied');
    await expect(withAccountContext(db, owner, (ctx) => ctx.deleteFrom('garmin_activity_resources').execute())).rejects.toThrow('permission denied');
  });
  it('reads bounded FIT session/lap messages in source order and isolates metadata from another account', async () => {
    const owner = randomUUID(), foreign = randomUUID();
    const ref = { identityKey: 'native:98765', sourceHash: 'c'.repeat(64) };
    const first = { message: 'lap', fields: [{ name: 'total_distance', value: 1000, units: 'm' }] };
    const second = { message: 'lap', fields: [{ name: 'total_distance', value: 2000, units: 'm' }] };
    const session = { message: 'session', fields: [{ name: 'avg_stance_time', value: 250, units: 'ms' }] };
    const expected = [{ resourceType: 'records', chunkIndex: 0 }, { resourceType: 'records', chunkIndex: 1 }, { resourceType: 'sets', chunkIndex: 0 }];
    await withAccountContext(db, owner, async ctx => {
      const repo = new GarminActivityResourcesRepository(ctx);
      await repo.retain(ref, { resourceType: 'records', chunkIndex: 0, payload: [first, { message: 'record', fields: [] }] });
      await repo.retain(ref, { resourceType: 'records', chunkIndex: 1, payload: [second, session] });
      await repo.retain(ref, { resourceType: 'fit_manifest', chunkIndex: 0, payload: { expectedResources: expected, objectKey: 'private-not-returned' } });
      expect(await repo.messages(ref, 'lap')).toEqual([first, second]);
      expect(await repo.messages(ref, 'lap', 1)).toEqual([first]);
      expect(await repo.messages(ref, 'session', 1)).toEqual([session]);
      expect(await repo.expectedResources(ref)).toEqual(expected);
    });
    await withAccountContext(db, foreign, async ctx => {
      const repo = new GarminActivityResourcesRepository(ctx);
      expect(await repo.messages(ref, 'session')).toEqual([]);
      expect(await repo.expectedResources(ref)).toBeNull();
    });
  });

});
