import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, GarminActivitiesRepository, LEGACY_ACCOUNT_ID, withAccountContext } from '@sportos/db';
const base = process.env.SPORTOS_ENRICHMENT_TEST_API_BASE;
const databaseUrl = process.env.SPORTOS_OWNER_TEST_DATABASE_URL;
const integration = base && databaseUrl ? describe : describe.skip;
integration('explicit enrichment isolated HTTP pipeline', () => {
  const id = randomUUID(); const native = String(Date.now()); const hash = createHash('sha256').update(id).digest('hex');
  let db: ReturnType<typeof createDb>; let identityId: string | undefined;
  beforeAll(async () => {
    const url = new URL(base!); const database = new URL(databaseUrl!);
    if (url.hostname !== '127.0.0.1' || url.port !== '43197' || database.hostname !== '127.0.0.1' || !database.pathname.endsWith('_test')) throw new Error('Disposable isolated API/database required.');
    db = createDb(databaseUrl);
    await withAccountContext(db, LEGACY_ACCOUNT_ID, ctx => ctx.insertInto('activities').values({ id, source:'manual', activity_date:'2044-01-02', start_time:new Date('2044-01-02T10:00:00Z'), activity_type:'run', subtype:'outdoor', duration_s:1800, moving_time_s:1800, distance_m:5000 }).execute());
  });
  afterAll(async () => {
    if (db) {
      await withAccountContext(db,LEGACY_ACCOUNT_ID,async ctx => { if(identityId) await new GarminActivitiesRepository(ctx).review(identityId,'reject',null); await ctx.deleteFrom('activities').where('id','=',id).execute(); });
      await db.destroy();
    }
  });
  it('navigation/status and cached reads do not fetch, retained Garmin renders and repeated POST reuses it', async () => {
    const snapshot = {providerActivityId:native,contentHash:hash,origin:'connect',sourceUpdatedAt:'2044-01-02T11:00:00Z',summary:{activityType:'run',subtype:'outdoor',startTime:'2044-01-02T10:00:00Z',elapsedTimeS:1800,movingTimeS:1800,distanceM:5000}};
    const coverage = await (await fetch(`${base}/activities/${id}/enrichment`)).json(); expect(coverage.garmin.state).toBe('missing'); expect(coverage.garmin.fetchEnabled).toBe(false);
    expect((await fetch(`${base}/activities/${id}/provider-detail`)).status).toBe(404);
    const resources=[{resourceType:'detail',chunkIndex:0},{resourceType:'sets',chunkIndex:0},{resourceType:'records',chunkIndex:0}];
    const payloads=[{metadataHash:'a'.repeat(64),metadata:{synthetic:true},details:{}},{exerciseSets:[]},[{message:'session',fields:[{name:'avg_stance_time',value:250,units:'ms'}]},{message:'lap',fields:[{name:'total_distance',value:1000,units:'m'}]}]];
    for(let i=0;i<resources.length;i++){
      const form=new FormData();form.append('file',new Blob([JSON.stringify({snapshot,...resources[i],payload:payloads[i]})],{type:'application/json'}),'resource.json');
      expect((await fetch(`${base}/garmin/local/resource`,{method:'POST',body:form})).status).toBe(201);
    }
    const original=Buffer.alloc(14);original.write('.FIT',8);const form=new FormData();form.append('file',new Blob([original]),'activity.fit');form.append('snapshot',JSON.stringify(snapshot));form.append('resources',JSON.stringify(resources));
    expect((await fetch(`${base}/garmin/local/original`,{method:'POST',body:form})).status).toBe(201);
    const linked=await (await fetch(`${base}/garmin/local/commit`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(snapshot)})).json();identityId=linked.id;
    expect(linked.activityId).toBe(id);
    const status=await (await fetch(`${base}/activities/${id}/enrichment`)).json();expect(status.garmin.state).toBe('cached');
    const detail=await (await fetch(`${base}/activities/${id}/garmin-detail`)).json();expect(detail.sessions[0].fields[0]).toEqual({name:'avg_stance_time',value:250,units:'ms'});expect(detail.laps).toHaveLength(1);
    for(const key of ['objectKey','sourceHash','owner_id','metadataHash'])expect(JSON.stringify(detail)).not.toContain(key);
    const resource=await (await fetch(`${base}/activities/${id}/garmin-detail/resource?resourceType=detail`)).json();expect(resource.payload).toEqual({metadata:{synthetic:true},details:{}});
    expect((await fetch(`${base}/activities/${id}/garmin-detail/resource?resourceType=fit_manifest`)).status).toBe(400);
    for(let i=0;i<2;i++) {const response=await fetch(`${base}/activities/${id}/garmin-detail`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});expect(response.status).toBe(201);expect((await response.json()).cacheStatus).toBe('hit');}
    const activity=await (await fetch(`${base}/activities/${id}`)).json();expect(activity.distance_m).toBe(5000);expect(activity.duration_s).toBe(1800);
  });
});
