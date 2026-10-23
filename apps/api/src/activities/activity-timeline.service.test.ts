import { NotFoundException } from '@nestjs/common';
import { ActivitiesRepository, ActivityProviderResourcesRepository, GarminActivityResourcesRepository } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityTimelineController } from './activity-timeline.controller.js';
import { ActivityTimelineService } from './activity-timeline.service.js';
const owner='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
function setup(garmin?: {identity_key:string;current_hash:string}) {
  const query = {select:vi.fn().mockReturnThis(),where:vi.fn().mockReturnThis(),executeTakeFirst:vi.fn(async()=>garmin)};
  const primary={withAccount:vi.fn(async(_owner:string,fn:(db:unknown)=>unknown)=>fn({selectFrom:()=>query}))};
  const detail={withAccount:vi.fn(async(_owner:string,fn:(db:unknown)=>unknown)=>fn({}))};
  return {primary,detail,service:new ActivityTimelineService(primary as never,detail as never)};
}
describe('activity timeline authorization and retained-only reads',()=>{
  afterEach(()=>vi.restoreAllMocks());
  it('validates the id and source allowlist, never accepts owner/filter input and forwards session ownership',async()=>{
    const read=vi.fn();const c=new ActivityTimelineController({read} as never);
    for(const query of [{},{source:'fit'},{source:['strava']},{source:'strava',owner}]) expect(()=>c.read(id,query,{id:owner} as never)).toThrow();
    expect(()=>c.read('invalid',{source:'strava'},{id:owner} as never)).toThrow();
    c.read(id,{source:'garmin'},{id:owner} as never);expect(read).toHaveBeenCalledWith(owner,id,'garmin');
    const swim = vi.fn(); const swimController = new ActivityTimelineController({swimLengths:swim} as never);
    expect(()=>swimController.swimLengths(id,{owner},{id:owner} as never)).toThrow();
    swimController.swimLengths(id,{},{id:owner} as never);
    expect(swim).toHaveBeenCalledWith(owner,id);
  });
  it('checks canonical visibility before auxiliary access for foreign and nonexistent identifiers',async()=>{
    const {service,detail}=setup();vi.spyOn(ActivitiesRepository.prototype,'get').mockResolvedValue(null);
    for(const source of ['strava','garmin'] as const) await expect(service.read(owner,id,source)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.swimLengths(owner,id)).rejects.toBeInstanceOf(NotFoundException);
    expect(detail.withAccount).not.toHaveBeenCalled();
  });
  it('does not inspect auxiliary resources for open-water or non-swimming activities',async()=>{
    const {service,detail}=setup();
    const get=vi.spyOn(ActivitiesRepository.prototype,'get');
    for(const activity of [{activity_type:'swim',subtype:'outdoor'},{activity_type:'run',subtype:'indoor'}]) {
      get.mockResolvedValue({id,...activity} as never);
      expect(await service.swimLengths(owner,id)).toMatchObject({reason:'not_pool_swim'});
    }
    expect(detail.withAccount).not.toHaveBeenCalled();
  });
  it('reads only retained streams inside the same owner context and rejects stale versions',async()=>{
    const {service,primary,detail}=setup();vi.spyOn(ActivitiesRepository.prototype,'get').mockResolvedValue({id} as never);
    vi.spyOn(ActivityProviderResourcesRepository.prototype,'getProviderReference').mockResolvedValue({providerVersion:'a'} as never);
    const streams=vi.spyOn(ActivityProviderResourcesRepository.prototype,'streams').mockResolvedValue({availability:'available',providerVersion:'b',payload:{}});
    expect(await service.read(owner,id,'strava')).toMatchObject({reason:'stale'});
    streams.mockResolvedValue({availability:'available',providerVersion:'a',payload:{time:{data:[0,1]},heartrate:{data:[140,141]}}});
    expect(await service.read(owner,id,'strava')).toMatchObject({status:'available',metrics:[{key:'heartRate'}]});
    for(const scoped of [primary,detail]) expect(scoped.withAccount).toHaveBeenCalledWith(owner,expect.any(Function));
  });
  it('reads pool splits through owner-bound current Garmin FIT evidence only',async()=>{
    const {service,detail}=setup({identity_key:'native:1',current_hash:'a'.repeat(64)});
    vi.spyOn(ActivitiesRepository.prototype,'get').mockResolvedValue({id,activity_type:'swim',subtype:'indoor'} as never);
    vi.spyOn(GarminActivityResourcesRepository.prototype,'coverage').mockResolvedValue([{resourceType:'records',chunkIndex:0},{resourceType:'sets',chunkIndex:0},{resourceType:'detail',chunkIndex:0}] as never);
    vi.spyOn(GarminActivityResourcesRepository.prototype,'expectedResources').mockResolvedValue(
      [{resourceType:'records',chunkIndex:0},{resourceType:'sets',chunkIndex:0},{resourceType:'detail',chunkIndex:0}]);
    vi.spyOn(GarminActivityResourcesRepository.prototype,'messages').mockResolvedValue([{message:'session',fields:[{name:'pool_length',value:25,units:'m'}]}] as never);
    vi.spyOn(GarminActivityResourcesRepository.prototype,'swimLengthMessages').mockResolvedValue(
      [{message:'length',fields:[{name:'length_type',value:'active',units:null},{name:'total_timer_time',value:24,units:'s'}]}] as never);
    expect(await service.swimLengths(owner,id)).toMatchObject({status:'available',poolLengthM:25,lengths:[{durationS:24,paceSPer100M:96}]});
    expect(detail.withAccount).toHaveBeenCalledWith(owner,expect.any(Function));
  });
  it('requires complete current Garmin resources before reading bounded native records',async()=>{
    const {service,detail}=setup({identity_key:'native:1',current_hash:'a'.repeat(64)});
    vi.spyOn(ActivitiesRepository.prototype,'get').mockResolvedValue({id} as never);
    vi.spyOn(GarminActivityResourcesRepository.prototype,'coverage').mockResolvedValue([{resourceType:'records',chunkIndex:0}] as never);
    const expected=vi.spyOn(GarminActivityResourcesRepository.prototype,'expectedResources').mockResolvedValue([{resourceType:'records',chunkIndex:0},{resourceType:'sets',chunkIndex:0},{resourceType:'detail',chunkIndex:0}]);
    const records=vi.spyOn(GarminActivityResourcesRepository.prototype,'timelineRecords').mockResolvedValue([]);
    expect(await service.read(owner,id,'garmin')).toMatchObject({reason:'incomplete_resources'});expect(records).not.toHaveBeenCalled();
    expected.mockResolvedValue(new Array(3).fill({resourceType:'records',chunkIndex:0}));
    await service.read(owner,id,'garmin');expect(records).toHaveBeenCalledWith({identityKey:'native:1',sourceHash:'a'.repeat(64)},0,150001);
    expect(detail.withAccount).toHaveBeenCalledWith(owner,expect.any(Function));
  });
});
