import { NotFoundException } from '@nestjs/common';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { ActivityProviderResourcesRepository,ActivityRouteProjectionsRepository } from '@sportos/db';
import { ActivityRouteProjectionService } from './activity-route-projection.service.js';
import { encodeRoutePolyline } from './activity-route-projection.js';
const id='11111111-1111-4111-8111-111111111111';
const owner='22222222-2222-4222-8222-222222222222';
const polyline=encodeRoutePolyline([[12,55],[12.01,55.01]]);
const validSummary={linked:true as const,polyline,polylineType:'string'};
const noSummary={linked:false as const,polyline:null,polylineType:null};
const strava={activityId:id,provider:'strava' as const,providerActivityId:'123',
 connectionId:'33333333-3333-4333-8333-333333333333',providerVersion:'a'.repeat(64)};
function service(){
 const scoped={withAccount:vi.fn(async (_owner:string,fn:(db:never)=>Promise<unknown>)=>fn({} as never))};
 const instance=new ActivityRouteProjectionService(scoped as never,scoped as never);
 const references=vi.spyOn(instance as any,'references');
 return {instance,references,scoped};
}
describe('retained route orchestration',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('serves current compact projections without reading rich bundles or calling providers',async()=>{
  const {instance,references,scoped}=service();
  references.mockResolvedValue({summary:validSummary,strava,stravaLinked:true,garmin:undefined});
  vi.spyOn(ActivityRouteProjectionsRepository.prototype,'get').mockResolvedValue({
   provider:'strava',resolution:'streams',source_ref:'123',source_version:'a'.repeat(64),
   algorithm_version:1,resource_hash:'b'.repeat(64),polylines:[polyline],
   bounds:[12,55,12.01,55.01],point_count:2,state:'current',
   source_fetched_at:new Date('2026-10-01T12:00:00Z'),
  } as never);
  const metadata=vi.spyOn(ActivityProviderResourcesRepository.prototype,'metadata').mockResolvedValue([
   {resourceType:'streams',availability:'available',providerVersion:strava.providerVersion,
    fetchedAt:new Date('2026-10-01T12:00:00Z')},
  ]);
  const rich=vi.spyOn(ActivityProviderResourcesRepository.prototype,'list');
  expect(await instance.read(owner,id)).toMatchObject({status:'available',source:'strava',resolution:'streams'});
  expect(scoped.withAccount).toHaveBeenCalledWith(owner,expect.any(Function));
  expect(rich).not.toHaveBeenCalled();
  expect(metadata).toHaveBeenCalledWith(strava);
 });
 it('falls back to the compact route when projection no longer matches the provider version',async()=>{
  const {instance,references}=service();
  references.mockResolvedValue({summary:validSummary,strava,stravaLinked:true,garmin:undefined});
  vi.spyOn(ActivityRouteProjectionsRepository.prototype,'get').mockResolvedValue({
   provider:'strava',resolution:'streams',source_ref:'123',source_version:'b'.repeat(64),
   algorithm_version:1,resource_hash:'b'.repeat(64),polylines:[polyline],
   bounds:[12,55,12.01,55.01],point_count:2,state:'current',
  } as never);
  expect(await instance.read(owner,id)).toMatchObject({status:'available',source:'strava',resolution:'summary'});
 });
 it('falls back to summary if auxiliary database is unavailable or V004 is not deployed',async()=>{
  const {instance,references}=service();
  references.mockResolvedValue({summary:validSummary,strava,stravaLinked:true,garmin:undefined});
  vi.spyOn(ActivityRouteProjectionsRepository.prototype,'get').mockRejectedValue(new Error('relation does not exist'));
  await expect(instance.read(owner,id)).resolves.toMatchObject({status:'available',resolution:'summary'});
 });
 it('refuses a stale same-version route after rich-resource refresh',async()=>{
  const {instance,references}=service();
  references.mockResolvedValue({summary:validSummary,strava,stravaLinked:true,garmin:undefined});
  vi.spyOn(ActivityRouteProjectionsRepository.prototype,'get').mockResolvedValue({
   provider:'strava',resolution:'streams',source_ref:'123',source_version:'a'.repeat(64),
   algorithm_version:1,resource_hash:'b'.repeat(64),polylines:[polyline],
   bounds:[12,55,12.01,55.01],point_count:2,state:'current',
   source_fetched_at:new Date('2026-10-01T12:00:00Z'),
  } as never);
  vi.spyOn(ActivityProviderResourcesRepository.prototype,'metadata').mockResolvedValue([{
   resourceType:'streams',availability:'available',providerVersion:strava.providerVersion,
   fetchedAt:new Date('2026-10-01T12:01:00Z'),
  }]);
  await expect(instance.read(owner,id)).resolves.toMatchObject({status:'available',resolution:'summary'});
 });
 it('never publishes Garmin FIT when an available Strava link has missing compact geometry',async()=>{
  const {instance,references}=service();
  references.mockResolvedValue({summary:noSummary,strava:null,stravaLinked:true,
   garmin:{identity_key:'native:123',current_hash:'a'.repeat(64)}});
  const publish=vi.spyOn(ActivityRouteProjectionsRepository.prototype,'publish');
  expect(await instance.project(owner,id)).toEqual({status:'unavailable'});
  expect(publish).not.toHaveBeenCalled();
 });
 it('keeps nonexistent/foreign canonical IDs indistinguishable',async()=>{
  const {instance,references}=service();
  references.mockRejectedValue(new NotFoundException('Activity was not found.'));
  await expect(instance.read(owner,id)).rejects.toBeInstanceOf(NotFoundException);
  await expect(instance.project(owner,id)).rejects.toBeInstanceOf(NotFoundException);
 });
});
