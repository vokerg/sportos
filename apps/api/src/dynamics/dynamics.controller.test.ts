import { BadRequestException } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { describe, expect, it, vi } from 'vitest';
import { DynamicsController, parseDynamicsQuery, parseRollingDynamicsQuery } from './dynamics.controller.js';
import type { DynamicsService } from './dynamics.service.js';

describe('DynamicsController', () => {
  it('validates and forwards a bounded query in the authenticated account context', async () => {
    const service = { read: vi.fn().mockResolvedValue({ monthly: [], series: [] }) };
    const controller = new DynamicsController(service as unknown as DynamicsService);
    const account = { id: '10000000-0000-4000-8000-000000000001' } as never;

    await controller.monthly({
      from: '2026-01-01', to: '2026-03-31', granularity: 'weekly', metrics: 'score,run',
    }, account);

    expect(service.read).toHaveBeenCalledWith({
      from: '2026-01-01', to: '2026-03-31', granularity: 'weekly', metrics: ['score', 'run'],
    }, '10000000-0000-4000-8000-000000000001');
  });

  it('uses the legacy account only when the auth decorator supplies no account', async () => {
    const service = { read: vi.fn().mockResolvedValue({}) };
    const controller = new DynamicsController(service as unknown as DynamicsService);
    await controller.monthly({ from: '2026-01-01', to: '2026-01-31' });
    expect(service.read).toHaveBeenCalledWith(expect.anything(), LEGACY_ACCOUNT_ID);
  });

  it('rejects missing, malformed, oversized, duplicate, and unknown input before querying', () => {
    const invalid = [
      {},
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2020-01-01', to: '2031-01-01' },
      { from: '2026-01-01', to: '2026-01-31', granularity: 'yearly' },
      { from: '2026-01-01', to: '2026-01-31', metrics: 'score,score' },
      { from: '2026-01-01', to: '2026-01-31', metrics: 'score,heartRate' },
      { from: '2026-01-01', to: '2026-01-31', ownerId: 'foreign' },
      { from: ['2026-01-01'], to: '2026-01-31' },
    ];
    for (const query of invalid) expect(() => parseDynamicsQuery(query)).toThrow(BadRequestException);
  });

  it('validates rolling metric/window combinations and forwards account context', async () => {
    const service = { rolling: vi.fn().mockResolvedValue({ points: [] }) };
    const controller = new DynamicsController(service as unknown as DynamicsService);
    const account = { id: '10000000-0000-4000-8000-000000000001' } as never;
    await controller.rolling({ from: '2026-01-01', to: '2026-03-31', metric: 'run', windows: '10,30,365' }, account);
    expect(service.rolling).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-03-31', metric: 'run', windows: [10, 30, 365] }, '10000000-0000-4000-8000-000000000001');

    for (const query of [
      { from: '2026-01-01', to: '2026-03-31', metric: 'heartRate' },
      { from: '2026-01-01', to: '2026-03-31', windows: '30,30' },
      { from: '2026-01-01', to: '2026-03-31', windows: '7,30' },
      { from: '2026-01-01', to: '2026-03-31', ownerId: 'foreign' },
    ]) expect(() => parseRollingDynamicsQuery(query)).toThrow(BadRequestException);
  });
});
