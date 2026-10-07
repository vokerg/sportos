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
    expect(await retain('b'.repeat(64))).toBe(true);
    expect(await withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).read(ref, 'sets'))).toEqual({ payload: resource.payload });
    expect(await withAccountContext(db, foreign, (ctx) => new GarminActivityResourcesRepository(ctx).read(ref, 'sets'))).toBeNull();
    expect(await withAccountContext(db, foreign, (ctx) => new GarminActivityResourcesRepository(ctx).coverage(ref))).toEqual([]);
    await expect(withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).retain(ref, { ...resource, payload: { sets: [] } }))).rejects.toThrow('conflicts');
    await expect(withAccountContext(db, owner, (ctx) => new GarminActivityResourcesRepository(ctx).retain(ref, { ...resource, payload: 'x'.repeat(4_000_001) }))).rejects.toThrow('bounded');
    await expect(withAccountContext(db, owner, (ctx) => ctx.updateTable('garmin_activity_resources').set({ payload_json: {} }).execute())).rejects.toThrow('permission denied');
    await expect(withAccountContext(db, owner, (ctx) => ctx.deleteFrom('garmin_activity_resources').execute())).rejects.toThrow('permission denied');
  });
});
