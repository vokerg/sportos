import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../pool.js';
import { withAccountContext } from '../ownership-context.js';
import { GarminDayRepository, GarminDayResourcesRepository } from './garmin-day.repository.js';
const primaryUrl=process.env.SPORTOS_OWNER_TEST_DATABASE_URL, detailUrl=process.env.SPORTOS_ACTIVITY_DETAIL_TEST_DATABASE_URL;
const integration=primaryUrl && detailUrl ? describe : describe.skip;
integration('Garmin day provenance and RLS',()=>{
  const date='2026-03-29',hash='a'.repeat(64);let primary:ReturnType<typeof createDb>,detail:ReturnType<typeof createDb>,owner:string,foreign:string;
  beforeAll(async()=>{
    for(const url of [primaryUrl!,detailUrl!]) if(new URL(url).hostname!=='127.0.0.1') throw new Error('Disposable loopback databases required for immutable synthetic fixtures.');
    primary=createDb(primaryUrl!);detail=createDb(detailUrl!);
    owner=(await primary.insertInto('accounts').values({display_name:'Synthetic Garmin day',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    foreign=(await primary.insertInto('accounts').values({display_name:'Synthetic foreign',email:null,status:'active'}).returning('id').executeTakeFirstOrThrow()).id;
    const role=await sql<{rolsuper:boolean;rolbypassrls:boolean}>`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`.execute(primary);
    expect(role.rows[0]).toEqual({rolsuper:false,rolbypassrls:false});
  });
  afterAll(async()=>{await primary?.destroy();await detail?.destroy();});
  it('retains raw before compact metadata, converges replay, versions changed refresh and preserves prior evidence on failure',async()=>{
    const payload={calendarDate:date,totalSteps:12345};
    await withAccountContext(detail,owner,db=>new GarminDayResourcesRepository(db).retain(date,'summary',hash,payload));
    const publish=(sourceHash=hash,steps=12345)=>withAccountContext(primary,owner,db=>new GarminDayRepository(db).publish(date,{category:'summary',state:'available',attemptedAt:new Date(),version:{hash:sourceHash,availability:'available',projection:{steps}}}));
    await publish();await publish();
    expect(await withAccountContext(primary,owner,db=>db.selectFrom('garmin_day_versions').selectAll().execute())).toHaveLength(1);
    await withAccountContext(detail,owner,db=>new GarminDayResourcesRepository(db).retain(date,'summary','b'.repeat(64),{...payload,totalSteps:12346}));
    await publish('b'.repeat(64),12346);await publish('b'.repeat(64),12346);
    expect(await withAccountContext(primary,owner,db=>db.selectFrom('garmin_day_versions').selectAll().execute())).toHaveLength(2);
    await withAccountContext(primary,owner,db=>new GarminDayRepository(db).publish(date,{category:'summary',state:'authentication_required',attemptedAt:new Date()}));
    const row=(await withAccountContext(primary,owner,db=>new GarminDayRepository(db).read(date)))[0]!;
    expect(row).toMatchObject({state:'authentication_required',projection_json:{steps:12346},availability:'available'});
    expect(await withAccountContext(detail,owner,db=>new GarminDayResourcesRepository(db).read(date,'summary',hash))).toEqual({payload_json:payload});
    await expect(publish(hash,777)).rejects.toThrow('conflicts');
    await expect(withAccountContext(detail,owner,db=>new GarminDayResourcesRepository(db).retain(date,'summary',hash,{totalSteps:777}))).rejects.toThrow('conflicts');
    // Old attempts cannot rewind the head.
    await withAccountContext(primary,owner,db=>new GarminDayRepository(db).publish(date,{category:'summary',state:'failed',attemptedAt:new Date('2020-01-01')}));
    expect((await withAccountContext(primary,owner,db=>new GarminDayRepository(db).read(date)))[0]?.state).toBe('authentication_required');
  });
  it('isolates reads, same-owner heads and immutable raw/provenance',async()=>{
    expect(await withAccountContext(primary,foreign,db=>new GarminDayRepository(db).read(date))).toEqual([]);
    expect(await withAccountContext(detail,foreign,db=>new GarminDayResourcesRepository(db).read(date,'summary',hash))).toBeUndefined();
    const version=await withAccountContext(primary,owner,db=>db.selectFrom('garmin_day_versions').select('id').executeTakeFirstOrThrow());
    await expect(withAccountContext(primary,foreign,db=>db.insertInto('garmin_day_heads').values({calendar_date:date,category:'summary',version_id:version.id,state:'available',attempt_json:{},attempted_at:new Date()}).execute())).rejects.toThrow();
    await expect(withAccountContext(primary,owner,db=>db.updateTable('garmin_day_heads').set({owner_id:foreign}).execute())).rejects.toThrow();
    await expect(withAccountContext(primary,owner,db=>db.updateTable('garmin_day_versions').set({projection_json:{steps:1}}).execute())).rejects.toThrow('permission denied');
    await expect(withAccountContext(detail,owner,db=>db.deleteFrom('garmin_day_resources').execute())).rejects.toThrow('permission denied');
  });
  it('denies dispatcher and worker-data access to day evidence',async()=>{
    for(const url of [process.env.SPORTOS_WORKER_TEST_DATABASE_URL,process.env.SPORTOS_WORKER_DATA_TEST_DATABASE_URL].filter((x):x is string=>Boolean(x))){
      const db=createDb(url);try{for(const table of ['garmin_day_versions','garmin_day_heads'] as const)await expect(db.selectFrom(table).selectAll().execute()).rejects.toThrow('permission denied');}finally{await db.destroy();}
    }
  });
});
