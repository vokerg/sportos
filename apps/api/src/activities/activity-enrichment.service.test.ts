import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { GarminActivityResourcesRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { ActivityEnrichmentService } from './activity-enrichment.service.js';
import { GarminLocalIngestService } from './garmin-local-ingest.service.js';
const id = '11111111-1111-4111-8111-111111111111';
const summary = { start_time: '2026-01-01T10:00:00Z', activity_type: 'run', subtype: 'outdoor', duration_s: 1800, moving_time_s: 1800, distance_m: 5000 };
function service(enabled = true) {
  return new ActivityEnrichmentService({} as never, { withAccount: vi.fn(async (_: string, fn: (db: unknown) => unknown) => fn({})) } as never, {} as never, { isDevelopmentMode: () => enabled } as never, { status: vi.fn(async () => ({ state: 'missing' })) } as never);
}
describe('ActivityEnrichmentService', () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.SPORTOS_GARMIN_LOCAL_FETCH_ENABLED; });
  it('metadata status uses bounded coverage without reading full records or contacting providers', async () => {
    const subject = service(); vi.spyOn(subject,'reference').mockResolvedValue({ activity: summary, garmin: { identity_key: 'native:123', current_hash: 'a'.repeat(64), status: 'manual' } } as never);
    vi.spyOn(GarminActivityResourcesRepository.prototype, 'coverage').mockResolvedValue([{ resourceType: 'detail', chunkIndex: 0 }, { resourceType: 'sets', chunkIndex: 0 }, { resourceType: 'records', chunkIndex: 0 }] as never);
    vi.spyOn(GarminActivityResourcesRepository.prototype, 'expectedResources').mockResolvedValue([{ resourceType:'detail',chunkIndex:0 },{ resourceType:'sets',chunkIndex:0 },{ resourceType:'records',chunkIndex:0 }]);
    const read = vi.spyOn(GarminActivityResourcesRepository.prototype, 'read'); const bridge = vi.spyOn(subject,'bridge');
    await expect(subject.status(LEGACY_ACCOUNT_ID,id)).resolves.toMatchObject({ garmin: { state:'cached', linked:true } }); expect(read).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
  });
  it('cached Garmin works without enabled helper or login, including archived fingerprint identities', async () => {
    const subject = service(false); vi.spyOn(subject,'reference').mockResolvedValue({ activity: summary, garmin: { identity_key: 'fingerprint:v1:'+ 'a'.repeat(64), current_hash: 'b'.repeat(64) } } as never);
    vi.spyOn(GarminLocalIngestService.prototype,'cachedBundle').mockResolvedValue(true); vi.spyOn(subject,'read').mockResolvedValue({ provider:'garmin' } as never); const bridge=vi.spyOn(subject,'bridge');
    await expect(subject.fetch({ id: LEGACY_ACCOUNT_ID } as never,id,false)).resolves.toMatchObject({ cacheStatus:'hit' }); expect(bridge).not.toHaveBeenCalled();
  });
  it('disables workstation tokens for production and other accounts even with the flag enabled', async () => {
    process.env.SPORTOS_GARMIN_LOCAL_FETCH_ENABLED='true'; const subject=service(false); expect(subject.localEnabled(LEGACY_ACCOUNT_ID)).toBe(false); expect(service().localEnabled(id)).toBe(false);
    vi.spyOn(subject,'reference').mockResolvedValue({ activity:summary } as never); const bridge=vi.spyOn(subject,'bridge');
    await expect(subject.fetch({id:LEGACY_ACCOUNT_ID} as never,id,false)).rejects.toMatchObject({response:{code:'GARMIN_LOCAL_FETCH_DISABLED'}}); expect(bridge).not.toHaveBeenCalled();
  });
  it('ambiguous discovery downloads no originals and writes no compact facts', async () => {
    process.env.SPORTOS_GARMIN_LOCAL_FETCH_ENABLED='true'; const subject=service(); vi.spyOn(subject,'reference').mockResolvedValue({ activity:summary } as never);
    const item = { activityType:'run',subtype:'outdoor',startTime:summary.start_time,elapsedTimeS:1800,movingTimeS:1800,distanceM:5000 };
    const bridge=vi.spyOn(subject,'bridge').mockResolvedValue({items:[{providerActivityId:'123',summary:item},{providerActivityId:'456',summary:item}],uncertain:false,truncated:false});
    const commit=vi.spyOn(GarminLocalIngestService.prototype,'commit');
    await expect(subject.fetch({id:LEGACY_ACCOUNT_ID} as never,id,false)).rejects.toBeInstanceOf(ConflictException); expect(bridge).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled();
  });
  it('foreign and missing activity identifiers fail before helper use or detail reads', async () => {
    const primary={withAccount:vi.fn(async()=>null)};
    const subject=new ActivityEnrichmentService(primary as never,{} as never,{} as never,{} as never,{} as never);
    const bridge=vi.spyOn(subject,'bridge');
    await expect(subject.reference(id,id)).rejects.toMatchObject({status:404}); expect(primary.withAccount).toHaveBeenCalledWith(id,expect.any(Function)); expect(bridge).not.toHaveBeenCalled();
  });
});
