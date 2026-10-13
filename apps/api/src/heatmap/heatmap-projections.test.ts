import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityProviderResourcesRepository, ActivityRouteProjectionsRepository, type HeatmapRouteCandidate } from '@sportos/db';
import type { ActivityDetailDbProvider } from '../db.provider.js';
import { encodeRoutePolyline } from '../activities/activity-route-projection.js';
import { assembleHeatmapRoutes } from './heatmap.controller.js';
import { readHeatmapProjectionUpgrades } from './heatmap-projections.js';

const owner = '22222222-2222-4222-8222-222222222222';
const id = '11111111-1111-4111-8111-111111111111';
const foreignId = '33333333-3333-4333-8333-333333333333';
const version = 'a'.repeat(64), garminVersion = 'c'.repeat(64);
const at = new Date('2026-10-01T10:00:00Z');
const first = encodeRoutePolyline([[12,55],[12.01,55.01]]);
const second = encodeRoutePolyline([[13,56],[13.01,56.01]]);
const strava: HeatmapRouteCandidate = {
  activityId:id,date:'2026-10-01',sport:'run',polyline:first,polylineType:'string',
  stravaLinked:true,stravaProviderActivityId:'strava-123',trustedProviderActivityId:'strava-123',
  stravaProviderVersion:version,trustedProviderVersion:version,
  garminIdentityKey:'native:garmin',garminCurrentHash:garminVersion,
};
const garmin: HeatmapRouteCandidate = {
  ...strava,polyline:null,polylineType:null,stravaLinked:false,
  stravaProviderActivityId:null,stravaProviderVersion:null,
  trustedProviderActivityId:null,trustedProviderVersion:null,
};
const stored = {
  activity_id:id, provider:'strava' as const,resolution:'streams' as const,
  state:'current' as const,source_ref:'strava-123',source_version:version,
  resource_hash:'b'.repeat(64),algorithm_version:1,
  polylines:[first,second],bounds:[12,55,13.01,56.01],point_count:4,source_fetched_at:at,
};
const metadata = {
  activityId:id, providerActivityId:'strava-123',resourceType:'streams' as const,
  providerVersion:version,availability:'available' as const,fetchedAt:at,
};
function fakeDetail() {
  return { withAccount:vi.fn(async <T>(_owner:string,run:(db:never)=>Promise<T>)=>run({} as never)) } as unknown as ActivityDetailDbProvider;
}
function mockData(rows: unknown[] = [stored],meta: unknown[] = [metadata], manifests: unknown[] = []) {
  const getMany = vi.spyOn(ActivityRouteProjectionsRepository.prototype,'getMany').mockResolvedValue(rows as never);
  const metadataMany = vi.spyOn(ActivityProviderResourcesRepository.prototype,'metadataMany').mockResolvedValue(meta as never);
  const fits = vi.spyOn(ActivityRouteProjectionsRepository.prototype,'availableGarminFits').mockResolvedValue(manifests as never);
  return {getMany,metadataMany,fits};
}
afterEach(()=>vi.restoreAllMocks());
describe('batch retained heatmap geometry',()=>{
  it('reuses current Strava streams and keeps disconnected parts with just bounded auxiliary metadata calls',async()=>{
    const mocks=mockData();
    const detail=fakeDetail();
    const upgrades=await readHeatmapProjectionUpgrades(owner,[strava],detail);
    expect(detail.withAccount).toHaveBeenCalledWith(owner,expect.any(Function));
    expect(mocks.getMany).toHaveBeenCalledOnce();
    expect(mocks.getMany).toHaveBeenCalledWith([id]);
    expect(mocks.metadataMany).toHaveBeenCalledWith([{activityId:id,providerActivityId:'strava-123'}]);
    expect(mocks.fits).toHaveBeenCalledWith([]);
    expect(upgrades.get(id)).toMatchObject({status:'available',source:'strava',resolution:'streams',
      geometry:{type:'MultiLineString',coordinates:[[[12,55],[12.01,55.01]],[[13,56],[13.01,56.01]]]}});
    const page=assembleHeatmapRoutes([strava],false,1,upgrades);
    expect(page.coverage.quality).toEqual({summary:0,streams:1,detail:0,fit:0});
  });
  it.each([
    ['stale projection',{state:'stale'} as object,{} as object,{} as object],
    ['old algorithm',{algorithm_version:2} as object,{} as object,{} as object],
    ['wrong version',{source_version:'d'.repeat(64)} as object,{} as object,{} as object],
    ['invalid resource hash',{resource_hash:'invalid'} as object,{} as object,{} as object],
    ['changed source ref',{source_ref:'other'} as object,{} as object,{} as object],
    ['mismatched bounds',{bounds:[0,0,1,1]} as object,{} as object,{} as object],
    ['resource unavailable',{} as object,{availability:'unavailable'} as object,{} as object],
    ['resource refreshed',{} as object,{fetchedAt:new Date('2026-10-01T10:01:00Z')} as object,{} as object],
    ['untrusted new link',{} as object,{} as object,{stravaProviderActivityId:'newer'} as object],
    ['invalid privacy summary',{} as object,{} as object,{polyline:null} as object],
    ['missing summary',{} as object,{} as object,{polylineType:null,polyline:null} as object],
  ])('rejects %s and falls back to the visibility-trimmed Strava summary',async (_label,deltaRow,deltaMeta,deltaCandidate)=>{
    mockData([{...stored,...deltaRow}],[{...metadata,...deltaMeta}]);
    const candidate={...strava,...deltaCandidate};
    const upgrade=await readHeatmapProjectionUpgrades(owner,[candidate],fakeDetail());
    expect(upgrade.size).toBe(0);
    const page=assembleHeatmapRoutes([candidate],false,1,upgrade);
    expect(page.items.every(item=>item.resolution==='summary')).toBe(true);
    expect(page.coverage.quality.streams).toBe(0);
  });
  it('allows current retained Garmin FIT only without any available Strava link',async()=>{
    const fit={...stored,provider:'garmin',resolution:'fit',source_ref:'native:garmin',source_version:garminVersion};
    const mocks=mockData([fit],[],[{identityKey:'native:garmin',sourceHash:garminVersion}]);
    const route=await readHeatmapProjectionUpgrades(owner,[garmin],fakeDetail());
    expect(route.get(id)).toMatchObject({status:'available',source:'garmin',resolution:'fit'});
    expect(mocks.metadataMany).toHaveBeenCalledWith([]);
    expect(mocks.fits).toHaveBeenCalledWith([{identityKey:'native:garmin',sourceHash:garminVersion}]);
    expect(assembleHeatmapRoutes([garmin],false,1,route).coverage.quality.fit).toBe(1);
  });
  it('rejects tempting Garmin FIT if Strava identity exists, even without valid summary',async()=>{
    const fit={...stored,provider:'garmin',resolution:'fit',source_ref:'native:garmin',source_version:garminVersion};
    mockData([fit],[],[{identityKey:'native:garmin',sourceHash:garminVersion}]);
    const candidate={...strava,polyline:null,polylineType:null};
    const route=await readHeatmapProjectionUpgrades(owner,[candidate],fakeDetail());
    expect(route.size).toBe(0);
    expect(assembleHeatmapRoutes([candidate],false,1,route)).toMatchObject({
      items:[],coverage:{missingGps:1,quality:{fit:0}},
    });
  });
  it('rejects missing retained FIT, mismatched source hash or identity after a refresh',async()=>{
    const fit={...stored,provider:'garmin',resolution:'fit',source_ref:'native:garmin',source_version:garminVersion};
    for(const candidate of [garmin,{...garmin,garminCurrentHash:'d'.repeat(64)},
      {...garmin,garminIdentityKey:'native:different'}]){
      mockData([fit],[],[]);
      expect((await readHeatmapProjectionUpgrades(owner,[candidate],fakeDetail())).size).toBe(0);
      vi.restoreAllMocks();
    }
  });
  it('cannot use an auxiliary row for another owner or canonical ID',async()=>{
    mockData([{...stored,activity_id:foreignId}], [metadata]);
    const result=await readHeatmapProjectionUpgrades(owner,[strava],fakeDetail());
    expect(result.size).toBe(0);
  });
  it('checks all 200 primary candidates in one bounded projection batch', async () => {
    const mocks = mockData([], [], []);
    const candidates = Array.from({length:200}, (_,i) => ({...strava,activityId:String(i)}));
    expect((await readHeatmapProjectionUpgrades(owner,candidates,fakeDetail())).size).toBe(0);
    expect(mocks.getMany).toHaveBeenCalledWith(candidates.map(c => c.activityId));
  });
  it('enforces the bounded page size before any auxiliary read',async()=>{
    const detail=fakeDetail();
    await expect(readHeatmapProjectionUpgrades(owner,Array.from({length:201},()=>strava),detail)).rejects.toThrow('page exceeds');
    expect(detail.withAccount).not.toHaveBeenCalled();
  });
});
