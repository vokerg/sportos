import { afterEach, describe, expect, it, vi } from 'vitest';
import { GARMIN_DAY_CATEGORIES, GarminDayRepository, GarminDayResourcesRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { GarminLocalIngestService } from '../activities/garmin-local-ingest.service.js';
import { GarminDayService } from './garmin-day.service.js';
const date='2026-03-29', hash='a'.repeat(64), account={id:LEGACY_ACCOUNT_ID,displayName:'Test',email:null};
function setup(enabled=true) {
  const primary={withAccount:vi.fn(async (_owner: string,fn:(db:unknown)=>unknown) => fn({}))};
  const detail={withAccount:vi.fn(async (_owner: string,fn:(db:unknown)=>unknown) => fn({}))};
  const enrichment={localEnabled:vi.fn(()=>enabled),bridge:vi.fn()};
  const service=new GarminDayService(primary as never,detail as never,{} as never,enrichment as never);
  const rows=vi.spyOn(GarminDayRepository.prototype,'read').mockResolvedValue([]);
  const publish=vi.spyOn(GarminDayRepository.prototype,'publish').mockResolvedValue(undefined);
  const retain=vi.spyOn(GarminDayResourcesRepository.prototype,'retain').mockResolvedValue(undefined);
  vi.spyOn(GarminDayResourcesRepository.prototype,'read').mockResolvedValue({payload_json:{}});
  return {service,primary,detail,enrichment,rows,publish,retain};
}
const bundle=(changes: Record<string,unknown>={})=>({schema:'sportos.garmin-day.v1',date,categories:GARMIN_DAY_CATEGORIES.map(category=>({category,state:'unsupported',...changes}))});
describe('Garmin day workflow',()=>{
  afterEach(()=>vi.restoreAllMocks());
  it('GET is compact, owner-scoped, private and never calls the bridge/detail database',async()=>{
    const {service,primary,detail,enrichment,rows}=setup();
    rows.mockResolvedValue([{category:'summary',state:'available',source_hash:hash,projection_json:{steps:123},retrieved_at:new Date('2026-03-30'),attempted_at:new Date('2026-03-30'),availability:'available'}] as never);
    const result=await service.read(account.id,date);
    expect(result.categories[0]).toMatchObject({category:'summary',evidence:{steps:123}});
    for(const key of ['source_hash',hash,'owner_id','objectKey','path']) expect(JSON.stringify(result)).not.toContain(key);
    expect(primary.withAccount).toHaveBeenCalledWith(account.id,expect.any(Function)); expect(enrichment.bridge).not.toHaveBeenCalled();expect(detail.withAccount).not.toHaveBeenCalled();
  });
  it('returns cached completed data without login or redundant Garmin requests',async()=>{
    const {service,enrichment,rows}=setup(false);
    rows.mockResolvedValue(GARMIN_DAY_CATEGORIES.map(category=>({category,state:'unsupported',source_hash:null,projection_json:null,attempted_at:new Date()})) as never);
    expect((await service.fetch(account,date,false)).result).toBe('cached');expect(enrichment.bridge).not.toHaveBeenCalled();
  });
  it('repairs a retained walking-only failure without a provider call or score write',async()=>{
    const {service,enrichment,rows,publish}=setup(false);
    const retained=GARMIN_DAY_CATEGORIES.map(category=>({category,state:'unsupported',source_hash:null,projection_json:null,attempted_at:new Date()}));
    const walking={category:'activities',state:'failed',source_hash:hash,projection_json:{identities:['native:1'],complete:true},attempt_json:{failures:[{identityKey:'native:1',state:'failed'}]},attempted_at:new Date(),retrieved_at:new Date(),availability:'available'};
    rows.mockResolvedValueOnce([...retained.filter(row=>row.category!=='activities'),walking] as never)
      .mockResolvedValue([...retained.filter(row=>row.category!=='activities'),{...walking,state:'available',attempt_json:{failures:[],excludedIdentities:['native:1']}}] as never);
    vi.mocked(GarminDayResourcesRepository.prototype.read).mockResolvedValue({payload_json:{items:[{activityId:'1',activityType:{typeKey:'walking'}}]}});
    const result=await service.fetch(account,date,false);
    expect(result.result).toBe('cached');expect(enrichment.bridge).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(date,expect.objectContaining({state:'available',attempt:{failures:[],excludedIdentities:['native:1']}}));
  });
  it('disables new upstream requests when local helper policy forbids the account',async()=>{
    const {service,enrichment}=setup(false);
    await expect(service.fetch(account,date,false)).rejects.toMatchObject({response:{code:'GARMIN_LOCAL_FETCH_DISABLED'}});expect(enrichment.bridge).not.toHaveBeenCalled();
  });
  it('retains raw successful categories before compact publication, preserves failures and never recalculates',async()=>{
    const {service,enrichment,publish,retain}=setup();
    const input=bundle(); input.categories[0]={category:'summary',state:'available',sourceHash:hash,byteSize:100} as never;
    input.categories[2]={category:'sleep',state:'failed'}; enrichment.bridge.mockResolvedValue(input);
    vi.spyOn(service,'localPayload').mockResolvedValue({calendarDate:date,totalSteps:12345});
    await service.fetch(account,date,false);
    expect(retain).toHaveBeenCalledWith(date,'summary',hash,{calendarDate:date,totalSteps:12345});
    expect(publish).toHaveBeenCalledWith(date,expect.objectContaining({category:'summary',state:'available',version:expect.objectContaining({projection:expect.objectContaining({steps:12345})})}));
    expect(retain.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]!);
    expect(publish).toHaveBeenCalledWith(date,expect.objectContaining({category:'sleep',state:'failed'}));
    expect(enrichment.bridge).toHaveBeenCalledTimes(1);expect(publish).toHaveBeenCalledTimes(8);
  });
  it('retries only missing/failed categories and leaves successful coverage intact',async()=>{
    const {service,enrichment,rows}=setup();
    rows.mockResolvedValue(GARMIN_DAY_CATEGORIES.map(category=>({category,state:category==='sleep'?'failed':'unsupported',source_hash:null,attempted_at:new Date()})) as never);
    enrichment.bridge.mockResolvedValue({schema:'sportos.garmin-day.v1',date,categories:[{category:'sleep',state:'not_recorded',sourceHash:hash,byteSize:4}]});
    vi.spyOn(service,'localPayload').mockResolvedValue(null);
    await service.fetch(account,date,false);expect(enrichment.bridge).toHaveBeenCalledWith({operation:'day',date,categories:['sleep']},expect.any(AbortSignal));
  });
  it('retains multiple activities through existing reconciliation and reports one failed detail independently',async()=>{
    const {service,enrichment,publish}=setup();
    const input=bundle();input.categories[7]={category:'activities',state:'available',sourceHash:hash,byteSize:100} as never;
    enrichment.bridge.mockImplementation(async request=>request.operation==='day'?input:{bundle:{snapshot:{providerActivityId:request.providerActivityId}}});
    vi.spyOn(service,'localPayload').mockResolvedValue({items:[{activityId:123,startTimeLocal:`${date} 00:05:00`},{activityId:456,startTimeLocal:`${date} 20:00:00`}],complete:true});
    const chain={select:()=>chain,where:()=>chain,executeTakeFirst:async()=>null};
    (service as unknown as {primary:{withAccount:ReturnType<typeof vi.fn>}}).primary.withAccount.mockImplementation(async (_owner,fn)=>fn({selectFrom:()=>chain}));
    const ingest=vi.spyOn(GarminLocalIngestService.prototype,'retainBundle').mockImplementation(async input=>{if(input.bundle.snapshot.providerActivityId==='456')throw new Error('private');return {activityId:'canonical',status:'strong_unique'} as never;});
    await service.fetch(account,date,false);
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(date,expect.objectContaining({category:'activities',state:'failed',version:expect.objectContaining({projection:{identities:['native:123','native:456'],complete:true}}),attempt:{failures:[{identityKey:'native:456',state:'failed'}]}}));
  });
  it('serializes repeated clicks and cancels helper work',async()=>{
    const {service,enrichment}=setup(); let resolve: (value:unknown)=>void=()=>{};
    enrichment.bridge.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const request=service.fetch(account,date,false);
    await vi.waitFor(()=>expect(enrichment.bridge).toHaveBeenCalled());
    await expect(service.fetch(account,date,false)).rejects.toMatchObject({response:{code:'GARMIN_FETCH_IN_PROGRESS'}});
    resolve(bundle());await request;
    const cancellation=new AbortController();cancellation.abort();
    await expect(service.fetch(account,date,false,cancellation.signal)).rejects.toMatchObject({response:{code:'GARMIN_FETCH_CANCELLED'}});
  });
});
