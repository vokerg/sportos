import { GarminLocalIngestService } from './garmin-local-ingest.service.js';
import { GarminActivityResourcesRepository, GarminActivitiesRepository } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityMetricsRepository, RetainedRunningEffortProjector, RunningEffortsRepository } from '@sportos/db';
import { RunningEffortsService } from './running-efforts.service.js';
import { ActivitiesController } from './activities.controller.js';
const id = '11111111-1111-4111-8111-111111111111', owner = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.restoreAllMocks());
describe('running effort API boundary', () => {
  it('forwards only the session owner and selected provider to retained processing', async () => {
    const primary = { withAccount: vi.fn(async (_: string, fn: (db: unknown) => unknown) => fn({})) };
    const detail = { withAccount: vi.fn(async (_: string, fn: (db: unknown) => unknown) => fn({})) };
    const project = vi.spyOn(RetainedRunningEffortProjector.prototype, 'project').mockResolvedValue([]);
    const service = new RunningEffortsService(primary as never, detail as never);
    await service.project(owner, id, 'strava'); expect(primary.withAccount).toHaveBeenCalledWith(owner, expect.any(Function)); expect(project).toHaveBeenCalledWith(id, false, 'strava');
    project.mockRejectedValue(new Error('private raw path/credential'));
    await expect(service.project(owner, id, 'garmin')).rejects.toMatchObject({ response: { code: 'EFFORT_PROJECTION_UNAVAILABLE' } });
  });
  it('rejects owner/download/private fields before reads and hides foreign IDs before processing', async () => {
    const primary = { withAccount: vi.fn().mockResolvedValue({ activity_type: 'run' }) };
    const efforts = { project: vi.fn().mockResolvedValue([]) };
    const controller = new ActivitiesController(primary as never, {} as never, {} as never, efforts as never);
    for (const body of [{ ownerId: owner }, { refresh: true }, { provider: 'strava' }, [], 'anything']) await expect(controller.reprocessEfforts(id, body, { id: owner } as never)).rejects.toMatchObject({ status: 400 });
    await expect(controller.reprocessEfforts('bad', {}, { id: owner } as never)).rejects.toMatchObject({ status: 400 }); expect(primary.withAccount).not.toHaveBeenCalled();
    await expect(controller.reprocessEfforts(id, {}, { id: owner } as never)).resolves.toEqual({ effortProjection: [] }); expect(efforts.project).toHaveBeenCalledWith(owner, id);
    primary.withAccount.mockResolvedValue(null); await expect(controller.reprocessEfforts(id, {}, { id: owner } as never)).rejects.toMatchObject({ status: 404 });
    primary.withAccount.mockResolvedValue({ activity_type: 'bike' }); await expect(controller.reprocessEfforts(id, {}, { id: owner } as never)).rejects.toMatchObject({ status: 400 }); expect(efforts.project).toHaveBeenCalledTimes(1);
  });
  it('invalidates only linked runs before mutable Strava replacement', async () => {
    const query = { select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), executeTakeFirst: vi.fn().mockResolvedValue({ activity_type: 'run' }) };
    const db = { selectFrom: vi.fn(() => query), executeQuery: vi.fn().mockResolvedValue({ rows: [{ time: '2026-10-01' }] }) };
    // Mark owns its source/freshness check; the service never supplies an owner from input.
    const references = vi.spyOn(ActivityMetricsRepository.prototype, 'references').mockResolvedValue([{ activityId: id, provider: 'strava', sourceRef: id, sourceVersion: 'a'.repeat(64) }]);
    const mark = vi.spyOn(RunningEffortsRepository.prototype, 'mark').mockResolvedValue();
    const primary = { withAccount: vi.fn(async (_: string, fn: (db: unknown) => unknown) => fn(db)) };
    // Query executor needed for the clock SQL is best exercised in integration;
    // non-running preflight is entirely primary and avoids even that clock.
    query.executeTakeFirst.mockResolvedValue({ activity_type: 'bike' });
    await new RunningEffortsService(primary as never, {} as never).invalidate(owner, id, {});
    expect(primary.withAccount).toHaveBeenCalledWith(owner, expect.any(Function)); expect(references).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
    primary.withAccount.mockRejectedValueOnce(new Error('private database/source payload'));
    await expect(new RunningEffortsService(primary as never,{} as never).invalidate(owner,id,{})).rejects.toMatchObject({response:{code:'EFFORT_PROJECTION_UNAVAILABLE'}});
  });
});

it('explicit cached Garmin processing, including day reuse, projects only the resolved Garmin run',async()=>{
 const query={innerJoin:vi.fn().mockReturnThis(),select:vi.fn().mockReturnThis(),where:vi.fn().mockReturnThis(),orderBy:vi.fn().mockReturnThis(),executeTakeFirst:vi.fn().mockResolvedValue(undefined)};
 const primary={withAccount:vi.fn(async (_:string,fn:(db:unknown)=>unknown)=>fn({selectFrom:()=>query}))};
 const detail={withAccount:vi.fn(async (_:string,fn:(db:unknown)=>unknown)=>fn({}))};
 const efforts={project:vi.fn().mockResolvedValue([])};
 const retention=new GarminLocalIngestService(primary as never,detail as never,{} as never,{} as never,efforts as never);
 vi.spyOn(GarminActivityResourcesRepository.prototype,'coverage').mockResolvedValue([]);
 vi.spyOn(GarminActivityResourcesRepository.prototype,'read').mockResolvedValue({payload:{}});
 vi.spyOn(retention as unknown as {coverageComplete:()=>boolean},'coverageComplete').mockReturnValue(true);
 vi.spyOn(retention as unknown as {originalPresent:()=>Promise<boolean>},'originalPresent').mockResolvedValue(true);
 vi.spyOn(GarminActivitiesRepository.prototype,'reconsider').mockResolvedValue({activityId:id} as never);
 await expect(retention.cachedBundle('native:123','a'.repeat(64),{id:owner} as never)).resolves.toBe(true);
 expect(efforts.project).toHaveBeenCalledWith(owner,id,'garmin');
});
