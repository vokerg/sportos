import { describe, expect, it, vi } from 'vitest';
import { DynamicsRepository } from '@sportos/db';
import { DynamicsService } from './dynamics.service.js';
import type { DbProvider } from '../db.provider.js';

it('reads current owner daily rows and contributions once in one repeatable snapshot', async () => {
  const daily = vi.spyOn(DynamicsRepository.prototype, 'listDailyRows').mockResolvedValue([{metricDate:'2026-01-01',score:100,steps:1000,run:5000,bike:0,swim:0,workout:10,bonus:20}]);
  const contributions = vi.spyOn(DynamicsRepository.prototype, 'listScoreContributions').mockResolvedValue([]);
  const execute = vi.fn(async (callback) => callback({}));
  const setIsolationLevel = vi.fn(() => ({execute}));
  const withAccount = vi.fn(async (_account, callback) => callback({transaction:()=>({setIsolationLevel})}));
  try {
    const service = new DynamicsService({withAccount} as unknown as DbProvider);
    const result = await service.history('2026-01-02','owner-from-session');
    expect(withAccount).toHaveBeenCalledWith('owner-from-session',expect.any(Function));
    expect(setIsolationLevel).toHaveBeenCalledWith('repeatable read');
    expect(daily).toHaveBeenCalledExactlyOnceWith('1900-01-01','2026-01-02');
    expect(contributions).toHaveBeenCalledExactlyOnceWith('2026-01-01','2026-01-02',{importedFallback:'unattributed'});
    expect(result.records.find((r)=>r.metric==='score'&&r.period==='all')).toMatchObject({value:100,date:'2026-01-01'});
  } finally {daily.mockRestore();contributions.mockRestore();}
});
