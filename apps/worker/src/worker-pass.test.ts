import {afterEach, expect, it, vi} from 'vitest';
import * as database from '@sportos/db';
import {ImportJobRunner} from './import-job-runner.js';
import {RuleChangeRunner} from './rule-change-runner.js';
import {DailyRecalculationRunner} from './daily-recalculation-runner.js';
import {ProviderSyncRunner} from './provider-sync-runner.js';
import {GarminJobRunner} from './garmin-job-runner.js';
import {createWorkerPass} from './worker-pass.js';
afterEach(()=>vi.restoreAllMocks());

it('creates fresh pools per pass, closes every pool and excludes disabled queues from deadlines',async()=>{
  const destroy=vi.fn(async()=>undefined),create=vi.spyOn(database,'createDb').mockImplementation(()=>({destroy}) as never);
  const imports=vi.spyOn(ImportJobRunner.prototype,'processNext').mockResolvedValue(false);
  const rules=vi.spyOn(RuleChangeRunner.prototype,'processNext').mockResolvedValue(false);
  vi.spyOn(DailyRecalculationRunner.prototype,'processNext').mockResolvedValue(false);
  const deadline=vi.spyOn(database.WorkerDispatchRepository.prototype,'nextWakeAt').mockResolvedValue(null);
  const pass=createWorkerPass({dispatchUrl:'synthetic-dispatch',dataUrl:'synthetic-data',storage:{} as never,workerId:'synthetic',importsEnabled:false,concurrency:1,leaseSeconds:60,provider:null});
  for(let i=0;i<2;i++)expect(await pass(new AbortController().signal)).toBeNull();
  expect(create).toHaveBeenCalledTimes(4);expect(destroy).toHaveBeenCalledTimes(4);expect(imports).not.toHaveBeenCalled();
  expect(deadline).toHaveBeenLastCalledWith(['scoring_rule_changes','daily_recalculation_jobs']);
  deadline.mockResolvedValue(new Date(0));
  const first=await pass(new AbortController().signal),second=await pass(new AbortController().signal);
  expect(first!.getTime()).toBeGreaterThanOrEqual(Date.now()+900);
  expect(second!.getTime()).toBeGreaterThanOrEqual(Date.now()+1900);
  rules.mockRejectedValueOnce(new Error('failure'));
  await expect(pass(new AbortController().signal)).rejects.toThrow('failure');
  expect(destroy).toHaveBeenCalledTimes(10);
});

it('visits every enabled queue with bounded import concurrency and closes the detail pool too',async()=>{
  const destroy=vi.fn(async()=>undefined);vi.spyOn(database,'createDb').mockImplementation(()=>({destroy}) as never);
  const imports=vi.spyOn(ImportJobRunner.prototype,'processNext').mockResolvedValue(false);
  const rules=vi.spyOn(RuleChangeRunner.prototype,'processNext').mockResolvedValue(false);
  const daily=vi.spyOn(DailyRecalculationRunner.prototype,'processNext').mockResolvedValue(false);
  const provider=vi.spyOn(ProviderSyncRunner.prototype,'processNext').mockResolvedValue(false);
  const garmin=vi.spyOn(GarminJobRunner.prototype,'processNext').mockResolvedValue(false);
  const deadline=vi.spyOn(database.WorkerDispatchRepository.prototype,'nextWakeAt').mockResolvedValue(null);
  const pass=createWorkerPass({dispatchUrl:'synthetic',dataUrl:'synthetic',detailUrl:'synthetic',storage:{} as never,workerId:'synthetic',importsEnabled:true,concurrency:2,leaseSeconds:60,provider:{adapter:{} as never,cipher:{} as never},garminCipher:{} as never});
  await pass(new AbortController().signal);
  expect(imports).toHaveBeenCalledTimes(2);
  for(const handler of [rules,daily,provider,garmin])expect(handler).toHaveBeenCalledOnce();
  expect(deadline).toHaveBeenCalledWith(['scoring_rule_changes','daily_recalculation_jobs','import_jobs','provider_sync_jobs','garmin_jobs']);
  expect(destroy).toHaveBeenCalledTimes(3);
});
