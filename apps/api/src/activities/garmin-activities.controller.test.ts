import { describe, expect, it, vi } from 'vitest';
import { GarminActivitiesController, parseGarminSnapshot } from './garmin-activities.controller.js';
import { GarminActivitiesRepository } from '@sportos/db';
import type { DbProvider } from '../db.provider.js';
const fixture = () => ({ providerActivityId: '123', contentHash: 'a'.repeat(64), origin: 'connect', sourceUpdatedAt: '2026-10-07T10:00:00Z',
  summary: { activityType: 'run', subtype: 'outdoor', startTime: '2026-10-07T12:00:00+02:00', elapsedTimeS: 1800, movingTimeS: 1700, distanceM: 5000 } });
describe('Garmin activity ingress and review', () => {
  it('accepts only bounded compact metadata, preserving offset timestamps', () => {
    expect(parseGarminSnapshot(fixture()).summary.startTime.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    for (const data of [{ ...fixture(), ownerId: 'owner' }, { ...fixture(), raw: { token: 'secret' } }, { ...fixture(), providerActivityId: 123 }, { ...fixture(), providerActivityId: '0' }, { ...fixture(), contentHash: 'x' }, { ...fixture(), summary: { ...fixture().summary, notes: 'private' } }, { ...fixture(), summary: { ...fixture().summary, distanceM: '5000' } }, { ...fixture(), summary: { ...fixture().summary, startTime: '2026-02-30T10:00:00Z' } }, { ...fixture(), summary: { ...fixture().summary, startTime: '2026-10-07T10:00:00' } }]) {
      expect(() => parseGarminSnapshot(data)).toThrow();
    }
  });
  it('forwards the authenticated account and rejects invalid input before database work', async () => {
    const withAccount = vi.fn(async (_owner, callback) => callback({}));
    const controller = new GarminActivitiesController({ withAccount } as unknown as DbProvider);
    const ingest = vi.spyOn(GarminActivitiesRepository.prototype, 'ingest').mockResolvedValue({ id: 'test' } as never);
    await controller.ingest(fixture(), { id: 'signed-in-owner' } as never);
    expect(withAccount.mock.calls[0]?.[0]).toBe('signed-in-owner');
    expect(ingest.mock.calls[0]?.[0]).not.toHaveProperty('ownerId');
    withAccount.mockClear();
    await expect(controller.ingest({ ...fixture(), ownerId: 'other' })).rejects.toThrow();
    expect(withAccount).not.toHaveBeenCalled();
    ingest.mockRestore();
  });
  it('validates review decisions and UUIDs before repository access', async () => {
    const withAccount = vi.fn(); const controller = new GarminActivitiesController({ withAccount } as unknown as DbProvider);
    await expect(controller.review('invalid', { decision: 'reject', activityId: null })).rejects.toThrow();
    await expect(controller.review('00000000-0000-4000-8000-000000000001', { decision: 'reject', activityId: 'other' })).rejects.toThrow();
    await expect(controller.review('00000000-0000-4000-8000-000000000001', { decision: 'link', activityId: 'invalid' })).rejects.toThrow();
    expect(withAccount).not.toHaveBeenCalled();
  });
});
