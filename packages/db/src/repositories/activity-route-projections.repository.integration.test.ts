import { randomUUID } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { sql } from 'kysely';
import { withAccountContext as accountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { ActivityProviderResourcesRepository } from './activity-provider-resources.repository.js';
import { ActivityRouteProjectionsRepository } from './activity-route-projections.repository.js';

const url=process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
(url?describe:describe.skip)('compact GPS projections in auxiliary account-scoped database',()=>{
 it('upserts idempotently and prevents a different account from reading, mutating or forging ownership',async()=>rollbackFixture(async db=>{
  const owner=randomUUID(),foreign=randomUUID(),activityId=randomUUID();
  const base={
   activity_id:activityId,provider:'garmin' as const,resolution:'fit' as const,
   source_ref:'native:12345',source_version:'a'.repeat(64),resource_hash:'b'.repeat(64),
   algorithm_version:1,polylines:['??_ibE_ibE??'],bounds:[0,0,1,1] as [number,number,number,number],
   point_count:2,source_fetched_at:new Date('2026-10-01T10:00:00Z'),
  };
  const write=(o:string,w=base)=>withAccountContext(db,o,ctx=>new ActivityRouteProjectionsRepository(ctx).publish(w));
  expect(await write(owner)).toBeTruthy();
  const stored=await withAccountContext(db,owner,ctx=>new ActivityRouteProjectionsRepository(ctx).get(activityId));
  expect(stored).toMatchObject({provider:'garmin',resolution:'fit',source_version:base.source_version,point_count:2});
  expect(await write(owner)).toBeTruthy();
  expect(await withAccountContext(db,foreign,ctx=>new ActivityRouteProjectionsRepository(ctx).get(activityId))).toBeUndefined();
  expect(await withAccountContext(db,foreign,ctx=>new ActivityRouteProjectionsRepository(ctx).getMany([activityId]))).toEqual([]);
  expect(await withAccountContext(db,owner,ctx=>new ActivityRouteProjectionsRepository(ctx).getMany([activityId])))
   .toHaveLength(1);
  expect(await withAccountContext(db,owner,ctx=>new ActivityRouteProjectionsRepository(ctx).getMany(Array(200).fill(activityId)))).toHaveLength(1);
  await expect(withAccountContext(db,owner,ctx=>new ActivityRouteProjectionsRepository(ctx).getMany(Array(201).fill(activityId)))).rejects.toThrow(/page limit/);
  await withAccountContext(db,foreign,ctx=>new ActivityRouteProjectionsRepository(ctx).invalidate(activityId));
  expect(await withAccountContext(db,owner,ctx=>new ActivityRouteProjectionsRepository(ctx).get(activityId)))
   .toMatchObject({state:'current'});
  await expect(withAccountContext(db,foreign,ctx=>ctx.insertInto('activity_route_projections').values({
   ...base,owner_id:owner,polylines:base.polylines,bounds:base.bounds,
  }).execute())).rejects.toThrow();
  await expect(withAccountContext(db,owner,ctx=>ctx.updateTable('activity_route_projections')
   .set({owner_id:foreign}).where('activity_id','=',activityId).execute())).rejects.toThrow();
  await expect(withAccountContext(db,owner,ctx=>ctx.deleteFrom('activity_route_projections')
   .where('activity_id','=',activityId).execute())).rejects.toThrow();
 }), 30_000);
 it('does not let an older source timestamp overwrite newer geometry',async()=>rollbackFixture(async db=>{
  const owner=randomUUID(),activity=randomUUID();
  const old={activity_id:activity,provider:'strava' as const,resolution:'streams' as const,
   source_ref:'123456',source_version:'a'.repeat(64),resource_hash:'b'.repeat(64),
   algorithm_version:1,polylines:['??_ibE_ibE??'],bounds:[0,0,1,1] as [number,number,number,number],
   point_count:2,source_fetched_at:new Date('2026-10-01T00:00:00Z')};
  const newer={...old,resource_hash:'c'.repeat(64),source_fetched_at:new Date('2026-10-02T00:00:00Z')};
  await withAccountContext(db,owner,async ctx=>{
   const repo=new ActivityRouteProjectionsRepository(ctx);
   await repo.publish(newer);
   expect(await repo.publish(old)).toBeUndefined();
   expect(await repo.get(activity)).toMatchObject({resource_hash:newer.resource_hash});
   await repo.invalidate(activity);
   expect(await repo.get(activity)).toMatchObject({state:'stale'});
  });
 }), 30_000);

 it('returns both retained resource metadata rows for every candidate in a full 200-route page',async()=>rollbackFixture(async db=>{
  const owner=randomUUID(),foreign=randomUUID();
  const refs=Array.from({length:200},()=>({activityId:randomUUID(),providerActivityId:randomUUID()}));
  await withAccountContext(db,owner,ctx=>ctx.insertInto('activity_provider_resources').values(refs.flatMap(ref=>
   ['streams','detail'].map(resource_type=>({activity_id:ref.activityId,provider_activity_id:ref.providerActivityId,
    provider:'strava',resource_type,provider_version:'a'.repeat(64),payload_json:{}})))).execute());
  expect(await withAccountContext(db,owner,ctx=>new ActivityProviderResourcesRepository(ctx).metadataMany(refs))).toHaveLength(400);
  expect(await withAccountContext(db,foreign,ctx=>new ActivityProviderResourcesRepository(ctx).metadataMany(refs))).toEqual([]);
  await expect(withAccountContext(db,owner,ctx=>new ActivityProviderResourcesRepository(ctx).metadataMany([...refs,refs[0]!]))).rejects.toThrow(/page limit/);
 }), 30_000);

});

// Auxiliary runtime rows cannot be deleted. Keep every synthetic fixture inside
// one reserved connection/transaction and roll it back, including on failure.
async function rollbackFixture(run: (db: ReturnType<typeof createDb>) => Promise<void>) {
 const db = createDb(url!);
 try {
  await db.connection().execute(async connection => {
   await sql`begin`.execute(connection);
   try { await run(connection); }
   finally { await sql`rollback`.execute(connection); }
  });
 } finally { await db.destroy(); }
}

// Expected RLS/constraint failures abort a PostgreSQL transaction. Savepoints
// let each negative assertion recover without leaking synthetic persistent rows.
async function withAccountContext<T>(db: ReturnType<typeof createDb>, owner: string,
 run: (db: ReturnType<typeof createDb>) => Promise<T>): Promise<T> {
 await sql`savepoint assertion`.execute(db);
 try {
  const value = await accountContext(db, owner, run);
  await sql`release savepoint assertion`.execute(db);
  return value;
 } catch (error) {
  await sql`rollback to savepoint assertion`.execute(db);
  await sql`release savepoint assertion`.execute(db);
  throw error;
 }
}
