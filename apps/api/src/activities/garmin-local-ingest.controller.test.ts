import { describe, expect, it, vi } from 'vitest';
import { GarminLocalIngestController } from './garmin-local-ingest.controller.js';
import { GarminActivitiesRepository, GarminActivityResourcesRepository } from '@sportos/db';
import type { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import type { UploadStorage } from '../storage/upload-storage.js';
const snapshot = { providerActivityId: '12345', contentHash: 'a'.repeat(64), origin: 'connect', sourceUpdatedAt: '2026-10-07T10:00:00Z', summary: { activityType: 'run', subtype: 'outdoor', startTime: '2026-10-07T10:00:00Z', elapsedTimeS: 1800, movingTimeS: 1750, distanceM: 5000 } };
const jsonFile = (value: unknown) => { const buffer = Buffer.from(JSON.stringify(value)); return { buffer, size: buffer.length }; };
function setup() {
  const primary = { withAccount: vi.fn(async (_owner, callback) => callback({})) };
  const detail = { withAccount: vi.fn(async (_owner, callback) => callback({})) };
  const storage = { store: vi.fn(), read: vi.fn(), delete: vi.fn() };
  return { primary, detail, storage, controller: new GarminLocalIngestController(primary as unknown as DbProvider, detail as unknown as ActivityDetailDbProvider, storage as unknown as UploadStorage) };
}
describe('Garmin local artifact ingress', () => {
  it('rejects extra owner/path fields, oversized/invalid resources and original signatures before persistence', async () => {
    const { controller, primary, detail, storage } = setup();
    await expect(controller.retainResource(jsonFile({ snapshot, resourceType: 'records', chunkIndex: 0, payload: [], ownerId: 'other' }))).rejects.toThrow();
    await expect(controller.retainResource(jsonFile({ snapshot, resourceType: 'fit_manifest', chunkIndex: 0, payload: { objectKey: '../secret' } }))).rejects.toThrow();
    await expect(controller.retainOriginal({ buffer: Buffer.from('invalid-file'), size: 12 }, { snapshot: JSON.stringify(snapshot), resources: JSON.stringify([{ resourceType: 'detail', chunkIndex: 0 }, { resourceType: 'sets', chunkIndex: 0 }, { resourceType: 'records', chunkIndex: 0 }]) })).rejects.toThrow();
    await expect(controller.cache('invalid', { metadataHash: 'b'.repeat(64) })).rejects.toThrow();
    expect(primary.withAccount).not.toHaveBeenCalled(); expect(detail.withAccount).not.toHaveBeenCalled(); expect(storage.store).not.toHaveBeenCalled();
  });
  it('retains detail only in the separate database using authenticated owner and derived native identity', async () => {
    const { controller, primary, detail } = setup();
    const retain = vi.spyOn(GarminActivityResourcesRepository.prototype, 'retain').mockResolvedValue(true);
    try {
      expect(await controller.retainResource(jsonFile({ snapshot, resourceType: 'records', chunkIndex: 0, payload: [] }), { id: 'session-owner' } as never)).toEqual({ retained: true, inserted: true });
      expect(detail.withAccount.mock.calls[0]?.[0]).toBe('session-owner');
      expect(primary.withAccount).not.toHaveBeenCalled();
      expect(retain.mock.calls[0]?.[0]).toEqual({ identityKey: 'native:12345', sourceHash: 'a'.repeat(64) });
    } finally { retain.mockRestore(); }
  });
  it('sanitizes unexpected retention errors without exposing private payload/path text', async () => {
    const { controller } = setup();
    const retain = vi.spyOn(GarminActivityResourcesRepository.prototype, 'retain').mockRejectedValue(new Error('private/path and sensitive source content'));
    try {
      await expect(controller.retainResource(jsonFile({ snapshot, resourceType: 'records', chunkIndex: 0, payload: [] }))).rejects.toThrow('Garmin source retention is unavailable');
    } finally { retain.mockRestore(); }
  });

  it('refuses canonical reconciliation before original and all detail resources exist', async () => {
    const { controller, primary } = setup();
    const coverage = vi.spyOn(GarminActivityResourcesRepository.prototype, 'coverage').mockResolvedValue([]);
    const read = vi.spyOn(GarminActivityResourcesRepository.prototype, 'read').mockResolvedValue(null);
    try { await expect(controller.commit(snapshot)).rejects.toThrow('Retain original'); expect(primary.withAccount).not.toHaveBeenCalled(); }
    finally { coverage.mockRestore(); read.mockRestore(); }
  });
});
