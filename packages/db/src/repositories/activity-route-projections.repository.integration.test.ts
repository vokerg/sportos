import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { withAccountContext } from '../ownership-context.js';
import { createDb } from '../pool.js';
import { ActivityRouteProjectionsRepository } from './activity-route-projections.repository.js';

const url=process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
(url?describe:describe.skip)('compact GPS projections in auxiliary account-scoped database',()=>{
 let db:ReturnType<typeof createDb>;
 beforeAll(()=>{db=createDb(url!);});
 afterAll(async()=>db?.destroy());
 it('upserts idempotently and prevents a different account from reading, mutating or forging ownership',async()=>{
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
 });
 it('does not let an older source timestamp overwrite newer geometry',async()=>{
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
 });
});
