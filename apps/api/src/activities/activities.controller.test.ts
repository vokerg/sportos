import type { ActivityMetricsService } from './activity-metrics.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ActivitiesRepository, type Database, type Kysely } from '@sportos/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import type { ActivityProviderDetailService } from './activity-provider-detail.service.js';
import { ActivitiesController, parseActivitiesQuery, parseDistanceCorrectionBody } from './activities.controller.js';
import { ActivityDistanceCorrectionConflictError, ActivityDistanceCorrectionNoChangeError, ActivityDistanceCorrectionUnsupportedError } from '@sportos/db';

const id = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const account = { id: accountId } as never;

describe('ActivitiesController', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists with bounded defaults and validated type, date, and source filters in account context', async () => {
    const list = vi.spyOn(ActivitiesRepository.prototype, 'list').mockResolvedValue({ items: [], summary: { count: 0, durationS: 0, distanceM: 0, avgDistanceM: null, avgPaceSPerKm: null }, limit: 50, offset: 0 });
    const { controller, withAccount } = createController();
    await controller.list({}, account);
    expect(list).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    await controller.list({ from: '2026-01-01', to: '2026-01-31', activityType: 'bike', source: 'garmin', limit: '25', offset: '50' }, account);
    expect(list).toHaveBeenLastCalledWith({ from: '2026-01-01', to: '2026-01-31', activityType: 'bike', source: 'garmin', limit: 25, offset: 50 });
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
  });

  it('rejects invalid and private filters before repository access', () => {
    for (const query of [
      { activityType: 'cycle' }, { source: 'unknown' }, { from: '2026-02-30' },
      { from: '2026-03-01', to: '2026-02-01' }, { limit: '101' }, { offset: '-1' },
      { ownerId: accountId }, { source: ['strava', 'garmin'] },
      { activityType: 'run', minAvgSpeedMps: '5' },
      { activityType: 'bike', paceUnderSPerKm: '252' },
      { activityType: 'swim', swimPaceUnderSPer100m: 'Infinity' },
      { minDistanceM: '5000' },
      { activityType: 'bike', subtype: 'outdoor' },
      { activityType: 'run', subtype: 'indoor' },
    ]) expect(() => parseActivitiesQuery(query)).toThrow(BadRequestException);
  });

  it('accepts bounded canonical sport filters only with their matching type', () => {
    expect(parseActivitiesQuery({ activityType: 'run', minDistanceM: '5000', paceUnderSPerKm: '252' }))
      .toMatchObject({ activityType: 'run', minDistanceM: 5000, paceUnderSPerKm: 252 });
    expect(parseActivitiesQuery({ activityType: 'run', subtype: 'track' }))
      .toMatchObject({ activityType: 'run', subtype: 'track' });
    expect(parseActivitiesQuery({ activityType: 'bike', minDistanceM: '20000', minAvgSpeedMps: '6.25' }))
      .toMatchObject({ activityType: 'bike', minDistanceM: 20000, minAvgSpeedMps: 6.25 });
    expect(parseActivitiesQuery({ activityType: 'swim', swimPaceUnderSPer100m: '120' }))
      .toMatchObject({ activityType: 'swim', swimPaceUnderSPer100m: 120 });
  });

  it('fetches an activity and returns the same 404 for missing or foreign IDs', async () => {
    const get = vi.spyOn(ActivitiesRepository.prototype, 'get').mockResolvedValueOnce({ id } as never).mockResolvedValue(null);
    const { controller, withAccount } = createController();
    await expect(controller.detail(id, account)).resolves.toMatchObject({ id });
    await expect(controller.detail(id, account)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.detail(id, account)).rejects.toBeInstanceOf(NotFoundException);
    expect(get).toHaveBeenCalledTimes(3);
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
  });

  it('loads full provider detail through the authenticated account', async () => {
    const { controller, providerDetailService } = createController();
    providerDetailService.cached.mockResolvedValue({ provider: 'strava', providerActivityId: '20223486250' } as never);
    await expect(controller.providerDetail(id, account)).resolves.toMatchObject({ provider: 'strava' });
    expect(providerDetailService.cached).toHaveBeenCalledWith(accountId, id);
    expect(providerDetailService.load).not.toHaveBeenCalled();
  });

  it('fetches Strava only through an explicit validated POST and preserves the session owner', async () => {
    const { controller, providerDetailService } = createController();
    await controller.fetchProviderDetail(id, { refresh: true }, account);
    expect(providerDetailService.load).toHaveBeenCalledWith(accountId, id, true);
    await expect(controller.fetchProviderDetail(id, { ownerId: accountId }, account)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.fetchProviderDetail(id, { refresh: 'yes' }, account)).rejects.toBeInstanceOf(BadRequestException);
    expect(providerDetailService.load).toHaveBeenCalledTimes(1);
  });


  it('reads route evidence only within the authenticated account and never invokes provider fetch', async () => {
    const example = '_p~iF~ps|U_ulLnnqC_mqNvxq' + String.fromCharCode(96) + '@';
    const lookup = vi.spyOn(ActivitiesRepository.prototype, 'getStravaRouteEvidence')
      .mockResolvedValueOnce({ linked: true, polyline: example, polylineType: 'string' })
      .mockResolvedValueOnce({ linked: true, polyline: null, polylineType: null })
      .mockResolvedValueOnce({ linked: false, polyline: null, polylineType: null })
      .mockResolvedValueOnce({ linked: true, polyline: 'bad?', polylineType: 'string' })
      .mockResolvedValueOnce(null);
    const { controller, withAccount, providerDetailService } = createController();
    expect(await controller.map(id, account)).toMatchObject({
      status: 'available', source: 'strava', resolution: 'summary',
      geometry: { type: 'LineString', coordinates: [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]] },
    });
    expect(await controller.map(id, account)).toEqual({ status: 'unavailable', reason: 'summary_polyline_missing' });
    expect(await controller.map(id, account)).toEqual({ status: 'unavailable', reason: 'no_gps' });
    expect(await controller.map(id, account)).toEqual({ status: 'unavailable', reason: 'invalid_geometry' });
    await expect(controller.map(id, account)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.map('not-an-id', account)).rejects.toBeInstanceOf(BadRequestException);
    expect(lookup).toHaveBeenCalledTimes(5);
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
    expect(providerDetailService.load).not.toHaveBeenCalled();
    expect(providerDetailService.cached).not.toHaveBeenCalled();
  });

  it('reads retained source JSON only through account context and hides missing or foreign records', async () => {
    const source = { sourceRecordId: id, sourceRecordSource: 'strava_api', rawJson: { average_cadence: 88 } };
    const getSourceJson = vi.spyOn(ActivitiesRepository.prototype, 'getSourceJson').mockResolvedValueOnce(source).mockResolvedValue(null);
    const { controller, withAccount } = createController();
    await expect(controller.sourceJson(id, account)).resolves.toEqual(source);
    await expect(controller.sourceJson(id, account)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.sourceJson(id, account)).rejects.toBeInstanceOf(NotFoundException);
    expect(getSourceJson).toHaveBeenCalledWith(id);
    expect(withAccount).toHaveBeenCalledWith(accountId, expect.any(Function));
  });

  it('validates audited distance correction input and maps conflicts and unsupported targets', async () => {
    expect(parseDistanceCorrectionBody({ effectiveDistanceM: 1000, reason: 'First two lengths are one', expectedRevision: null }))
      .toEqual({ effectiveDistanceM: 1000, reason: 'First two lengths are one', expectedRevision: null });
    for (const body of [
      { effectiveDistanceM: 0, reason: 'x' },
      { effectiveDistanceM: 1000.001, reason: 'x' },
      { effectiveDistanceM: 1000, reason: '' },
      { effectiveDistanceM: 1000, reason: 'x', ownerId: accountId },
      { effectiveDistanceM: '1000', reason: 'x' },
    ]) expect(() => parseDistanceCorrectionBody(body)).toThrow(BadRequestException);

    const correction = {
      save: vi.fn().mockResolvedValue({ activityDate: '2026-10-21', correction: null, changed: true, dailyRecalculated: false }),
      reset: vi.fn(),
    };
    const { controller } = createController(correction);
    await expect(controller.saveDistanceCorrection(id, { effectiveDistanceM: 1000, reason: 'First two lengths are one' }, account))
      .resolves.toMatchObject({ activityId: id, changed: true });
    expect(correction.save).toHaveBeenCalledWith(accountId, id, 1000, 'First two lengths are one', null);
    correction.save.mockRejectedValueOnce(new ActivityDistanceCorrectionConflictError());
    await expect(controller.saveDistanceCorrection(id, { effectiveDistanceM: 1000, reason: 'retry' }, account)).rejects.toMatchObject({ status: 409 });
    correction.save.mockRejectedValueOnce(new ActivityDistanceCorrectionUnsupportedError());
    await expect(controller.saveDistanceCorrection(id, { effectiveDistanceM: 1000, reason: 'retry' }, account)).rejects.toMatchObject({ status: 400 });
    correction.save.mockRejectedValueOnce(new ActivityDistanceCorrectionNoChangeError());
    await expect(controller.saveDistanceCorrection(id, { effectiveDistanceM: 1000, reason: 'retry' }, account)).rejects.toMatchObject({ status: 400 });
  });

  it('validates reset fields and keeps missing activity responses generic', async () => {
    expect(() => parseDistanceCorrectionBody({ effectiveDistanceM: 1000, reason: 'x', expectedRevision: -1 })).toThrow(BadRequestException);
    const correction = { save: vi.fn(), reset: vi.fn().mockResolvedValue(null) };
    const { controller } = createController(correction);
    await expect(controller.resetDistanceCorrection(id, { expectedRevision: 1 }, account)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.resetDistanceCorrection(id, { ownerId: accountId }, account)).rejects.toBeInstanceOf(BadRequestException);
    expect(correction.reset).toHaveBeenCalledTimes(1);
    expect(correction.reset).toHaveBeenCalledWith(accountId, id, 1);
  });
});

function createController(distanceCorrections?: unknown) {
  const scopedDb = {} as Kysely<Database>;
  const withAccount = vi.fn(async <T>(_accountId: string, callback: (db: Kysely<Database>) => Promise<T>) => callback(scopedDb));
  const providerDetailService = { load: vi.fn(), cached: vi.fn() };
  return {
    controller: new ActivitiesController(
      { withAccount } as unknown as DbProvider,
      providerDetailService as unknown as ActivityProviderDetailService,
      undefined,
      undefined,
      undefined,
      distanceCorrections as never,
    ),
    withAccount,
    providerDetailService,
  };
}

it('allows walking history and distance filters without allowing run-specific filters',()=>{
 expect(parseActivitiesQuery({activityType:'walk',minDistanceM:'3000'})).toMatchObject({activityType:'walk',minDistanceM:3000});
 expect(()=>parseActivitiesQuery({activityType:'walk',paceUnderSPerKm:'300'})).toThrow(BadRequestException);
});

it('retained reprocessing derives the owner, rejects extra fields and hides foreign activities before processing',async()=>{
  const primary={withAccount:vi.fn(async (_:string,callback:(db:never)=>unknown)=>callback({} as never))};
  const metrics={project:vi.fn(async()=>[])};const controller=new ActivitiesController(primary as never,{} as never,metrics as unknown as ActivityMetricsService);
  const get=vi.spyOn(ActivitiesRepository.prototype,'get').mockResolvedValueOnce({id} as never).mockResolvedValue(null);
  await expect(controller.reprocess(id,{},account)).resolves.toEqual({metricProjection:[]});expect(metrics.project).toHaveBeenCalledWith(accountId,id);
  await expect(controller.reprocess(id,{ownerId:accountId},account)).rejects.toBeInstanceOf(BadRequestException);
  await expect(controller.reprocess(id,{refresh:true},account)).rejects.toBeInstanceOf(BadRequestException);
  await expect(controller.reprocess(id,[],account)).rejects.toBeInstanceOf(BadRequestException);
  await expect(controller.reprocess(id,{},account)).rejects.toBeInstanceOf(NotFoundException);
  expect(metrics.project).toHaveBeenCalledTimes(1);get.mockRestore();
});
