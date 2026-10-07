import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { BadRequestException, Inject, Injectable, ConflictException, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { GarminActivitiesRepository, GarminActivityResourcesRepository, GarminReconciliationConflict, garminIdentityKey, LEGACY_ACCOUNT_ID, type Json, type Kysely, type Database } from '@sportos/db';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { UploadStorage } from '../storage/upload-storage.js';
import { parseGarminSnapshot } from './garmin-activities.controller.js';

export interface LocalGarminBundle {
  folder: string;
  bundle: { snapshot: { providerActivityId: string; contentHash: string; origin: string; sourceUpdatedAt: string; summary: { startTime: string } };
    resources: { file: string; resourceType: string; chunkIndex: number }[];
    original: { file: string }; files: { file: string; sha256: string; size: number }[] };
}
interface LocalFile { buffer: Buffer; size: number; }
function record(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new BadRequestException('Invalid Garmin artifact envelope.');
  return value as Record<string, unknown>;
}
function parseFile(file: LocalFile | undefined) {
  if (!file || file.size > 4_000_000 || file.buffer.length !== file.size) throw new BadRequestException('A bounded Garmin JSON artifact is required.');
  try { return JSON.parse(file.buffer.toString('utf8')) as unknown; } catch { throw new BadRequestException('Invalid Garmin JSON artifact.'); }
}

@Injectable()
export class GarminLocalIngestService {
  constructor(
    @Inject(DbProvider) private readonly primary: DbProvider,
    @Inject(ActivityDetailDbProvider) private readonly detail: ActivityDetailDbProvider,
    @Inject(UploadStorage) private readonly storage: UploadStorage,
  ) {}

  async retainBundle(input: LocalGarminBundle, account: AuthenticatedAccount) {
    const bundle = input.bundle;
    if (!bundle || !Array.isArray(bundle.files) || bundle.files.length > 100 || !Array.isArray(bundle.resources) || bundle.resources.length > 100) throw new BadRequestException('Invalid local Garmin bundle.');
    const folder = resolve(input.folder);
    const root = join(homedir(), '.local', 'share', 'sportos', 'garmin', 'sources');
    if (!folder.startsWith(root + sep) || !/^[a-f0-9]{64}$/.test(folder.slice(root.length + 1)) || (await lstat(folder)).isSymbolicLink()) throw new BadRequestException('Invalid local source folder.');
    for (const path of [join(homedir(), '.local'), join(homedir(), '.local/share'), join(homedir(), '.local/share/sportos'), join(homedir(), '.local/share/sportos/garmin'), root]) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new BadRequestException('Invalid local Garmin directory.');
    }
    parseGarminSnapshot(bundle.snapshot);
    if (bundle.snapshot.contentHash !== folder.slice(root.length + 1) || createHash('sha256').update(JSON.stringify(bundle.files.map(file => [file.file, file.sha256]))).digest('hex') !== bundle.snapshot.contentHash) throw new BadRequestException('Invalid local Garmin source version.');
    const contents = new Map<string, Buffer>(); let total = 0;
    for (const file of bundle.files) {
      if (!/^(original\.(fit|zip)|activity\.fit|(detail|sets|records)-\d{1,5}\.json)$/.test(file.file)) throw new BadRequestException('Invalid local Garmin artifact.');
      const info = await lstat(join(folder, file.file));
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size || info.size > 20 * 1024 * 1024) throw new BadRequestException('Invalid local Garmin artifact.');
      const bytes = await readFile(join(folder,file.file)); total += bytes.length;
      if (total > 100 * 1024 * 1024 || bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new BadRequestException('Invalid local Garmin artifact content.');
      if (contents.has(file.file)) throw new BadRequestException('Repeated local Garmin artifact.');
      contents.set(file.file, bytes);
    }
    for (const item of bundle.resources) {
      const bytes = contents.get(item.file); if (!bytes) throw new BadRequestException('Missing Garmin artifact.');
      const envelope = Buffer.from(JSON.stringify({ snapshot: bundle.snapshot, resourceType: item.resourceType, chunkIndex: item.chunkIndex, payload: JSON.parse(bytes.toString('utf8')) as Json }));
      await this.retainResource({ buffer: envelope, size: envelope.length }, account);
    }
    const original = contents.get(bundle.original.file); if (!original) throw new BadRequestException('Missing Garmin original.');
    await this.retainOriginal({ buffer: original, size: original.length }, { snapshot: JSON.stringify(bundle.snapshot), resources: JSON.stringify(bundle.resources.map(item => ({ resourceType: item.resourceType, chunkIndex: item.chunkIndex }))) }, account);
    return this.commit(bundle.snapshot, account);
  }

  async cache(id: string, query: Record<string, unknown>, account?: AuthenticatedAccount) {
    if (!/^[0-9]{1,20}$/.test(id) || BigInt(id) === 0n || Object.keys(query).some((key) => key !== 'metadataHash')
      || typeof query.metadataHash !== 'string' || !/^[a-f0-9]{64}$/.test(query.metadataHash)) throw new BadRequestException('Invalid Garmin cache request.');
    const owner = account?.id ?? LEGACY_ACCOUNT_ID;
    const reference = await this.withAccount(this.primary, owner, (db) => db.selectFrom('garmin_activity_identities').select(['identity_key', 'current_hash'])
      .where('identity_key', '=', `native:${BigInt(id)}`).executeTakeFirst());
    if (!reference) return { current: false };
    return this.withAccount(this.detail, owner, async (db) => {
      const repo = new GarminActivityResourcesRepository(db);
      const ref = { identityKey: reference.identity_key, sourceHash: reference.current_hash };
      const data = await repo.read(ref, 'detail');
      const payload = data?.payload;
      const sameMetadata = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.metadataHash === query.metadataHash;
      const manifest = await repo.read(ref, 'fit_manifest');
      const coverage = await repo.coverage(ref);
      const complete = this.coverageComplete(manifest?.payload, coverage);
      const originalPresent = await this.originalPresent(manifest?.payload);
      return { current: Boolean(sameMetadata && originalPresent && complete) };
    });
  }

  async cachedBundle(identityKey: string, sourceHash: string, account: AuthenticatedAccount) {
    return this.withAccount(this.detail, account.id, async db => {
      const repo = new GarminActivityResourcesRepository(db);
      const ref = { identityKey, sourceHash };
      const [coverage, manifest] = await Promise.all([repo.coverage(ref), repo.read(ref, 'fit_manifest')]);
      return this.coverageComplete(manifest?.payload, coverage) && await this.originalPresent(manifest?.payload);
    });
  }

  async retainResource(file: LocalFile | undefined, account?: AuthenticatedAccount) {
    const input = record(parseFile(file), ['snapshot', 'resourceType', 'chunkIndex', 'payload']);
    const snapshot = parseGarminSnapshot(input.snapshot);
    if (!['detail', 'sets', 'records', 'laps'].includes(String(input.resourceType)) || !Number.isInteger(input.chunkIndex) || Number(input.chunkIndex) < 0 || Number(input.chunkIndex) > 10000 || !('payload' in input)) throw new BadRequestException('Invalid Garmin resource descriptor.');
    return this.withAccount(this.detail, account?.id ?? LEGACY_ACCOUNT_ID, async (db) => {
      const inserted = await new GarminActivityResourcesRepository(db).retain({ identityKey: garminIdentityKey(snapshot), sourceHash: snapshot.contentHash },
        { resourceType: input.resourceType as 'detail' | 'sets' | 'records' | 'laps', chunkIndex: input.chunkIndex as number, payload: input.payload as Json });
      return { retained: true, inserted };
    });
  }

  async retainOriginal(file: LocalFile | undefined, body: unknown, account?: AuthenticatedAccount) {
    const input = record(body, ['snapshot', 'resources']);
    const expectedResources = this.parseExpectedResources(input.resources);
    let raw: unknown;
    try { raw = JSON.parse(String(input.snapshot)); } catch { throw new BadRequestException('Invalid Garmin compact snapshot.'); }
    const snapshot = parseGarminSnapshot(raw);
    if (!file || file.size < 12 || file.size > 20 * 1024 * 1024 || file.size !== file.buffer.length) throw new BadRequestException('A bounded original Garmin activity file is required.');
    const extension = file.buffer.subarray(8, 12).equals(Buffer.from('.FIT')) ? 'fit' : file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ? 'zip' : null;
    if (!extension) throw new BadRequestException('Invalid original Garmin activity signature.');
    const owner = account?.id ?? LEGACY_ACCOUNT_ID;
    const reference = { identityKey: garminIdentityKey(snapshot), sourceHash: snapshot.contentHash };
    const existing = await this.withAccount(this.detail, owner, (db) => new GarminActivityResourcesRepository(db).read(reference, 'fit_manifest'));
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    if (existing) {
      const manifest = existing.payload;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.sha256 !== hash) throw new BadRequestException('Original Garmin source version conflicts with retained bytes.');
      if (!await this.originalPresent(manifest)) {
        const match = typeof manifest.objectKey === 'string' ? /^[a-f0-9]{2}\/([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(fit|zip)$/.exec(manifest.objectKey) : null;
        if (!match || manifest.storageProvider !== 'local' || match[2] !== extension || typeof manifest.objectKey !== 'string' || !manifest.objectKey.startsWith(hash.slice(0, 2) + '/')) throw new BadRequestException('Invalid retained original manifest.');
        try { await this.storage.store({ uploadId: match[1]!, sha256: hash, bytes: file.buffer, extension }); }
        catch { throw new BadRequestException('Original storage is unavailable or corrupt; restore the retained object before retrying.'); }
      }
      return { retained: true, inserted: false };
    }
    let stored;
    try { stored = await this.storage.store({ uploadId: randomUUID(), sha256: hash, bytes: file.buffer, extension }); }
    catch { throw new ServiceUnavailableException({ code: 'GARMIN_STORAGE_UNAVAILABLE', message: 'Original activity storage is unavailable.' }); }
    try {
      await this.withAccount(this.detail, owner, (db) => new GarminActivityResourcesRepository(db).retain(reference,
        { resourceType: 'fit_manifest', chunkIndex: 0, payload: { storageProvider: stored.provider, objectKey: stored.objectKey, sha256: hash, byteSize: file.size, extension, expectedResources } }));
    } catch (error) {
      // Concurrent identical delivery may win with a different opaque storage key.
      const winner = await this.withAccount(this.detail, owner, (db) => new GarminActivityResourcesRepository(db).read(reference, 'fit_manifest'));
      const manifest = winner?.payload;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.sha256 !== hash) throw error;
      try { await this.storage.delete(stored.objectKey); }
      catch { throw new ServiceUnavailableException({ code: 'GARMIN_STORAGE_UNAVAILABLE', message: 'Original activity storage cleanup is unavailable.' }); }
    }
    return { retained: true, inserted: true };
  }

  async commit(raw: unknown, account?: AuthenticatedAccount) {
    const snapshot = parseGarminSnapshot(raw);
    const owner = account?.id ?? LEGACY_ACCOUNT_ID;
    const ref = { identityKey: garminIdentityKey(snapshot), sourceHash: snapshot.contentHash };
    const ready = await this.withAccount(this.detail, owner, async (db) => {
      const repo = new GarminActivityResourcesRepository(db);
      const coverage = await repo.coverage(ref);
      const manifest = await repo.read(ref, 'fit_manifest');
      return await this.originalPresent(manifest?.payload) && this.coverageComplete(manifest?.payload, coverage);
    });
    if (!ready) throw new BadRequestException('Retain original and required detail resources before reconciliation.');
    return this.withAccount(this.primary, owner, (db) => new GarminActivitiesRepository(db).ingest(snapshot));
  }

  private async withAccount<T>(provider: DbProvider | ActivityDetailDbProvider, owner: string, callback: (db: Kysely<Database>) => Promise<T>): Promise<T> {
    try { return await provider.withAccount(owner, callback); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof GarminReconciliationConflict) throw new ConflictException({ code: 'GARMIN_RECONCILIATION_CONFLICT', message: 'Retained source metadata conflicts with the supplied version.' });
      throw new ServiceUnavailableException({ code: 'GARMIN_RETENTION_UNAVAILABLE', message: 'Garmin source retention is unavailable. Retry after checking storage and source version.' });
    }
  }

  private parseExpectedResources(raw: unknown): { resourceType: string; chunkIndex: number }[] {
    let data: unknown;
    try { data = JSON.parse(String(raw)); } catch { throw new BadRequestException('Invalid Garmin resource manifest.'); }
    if (!Array.isArray(data) || data.length < 3 || data.length > 100) throw new BadRequestException('Invalid Garmin resource count.');
    const descriptors = data.map((item) => {
      const entry = record(item, ['resourceType', 'chunkIndex']);
      if (!['detail', 'sets', 'records', 'laps'].includes(String(entry.resourceType)) || !Number.isInteger(entry.chunkIndex) || Number(entry.chunkIndex) < 0 || Number(entry.chunkIndex) > 10000) throw new BadRequestException('Invalid Garmin resource manifest.');
      return { resourceType: String(entry.resourceType), chunkIndex: Number(entry.chunkIndex) };
    });
    const keys = descriptors.map((item) => `${item.resourceType}:${item.chunkIndex}`);
    if (new Set(keys).size !== keys.length || !['detail:0', 'sets:0', 'records:0'].every((key) => keys.includes(key))) throw new BadRequestException('Garmin resources are incomplete or repeated.');
    return descriptors;
  }

  private coverageComplete(payload: Json | undefined, coverage: { resourceType: string; chunkIndex: number }[]) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.expectedResources)) return false;
    return payload.expectedResources.length >= 3 && payload.expectedResources.every((item) => item && typeof item === 'object' && !Array.isArray(item)
      && coverage.some((row) => row.resourceType === item.resourceType && row.chunkIndex === item.chunkIndex));
  }

  private async originalPresent(payload: Json | undefined) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.storageProvider !== 'local'
      || typeof payload.objectKey !== 'string' || typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(payload.sha256)) return false;
    try {
      const bytes = await this.storage.read(payload.objectKey);
      return bytes.length === payload.byteSize && createHash('sha256').update(bytes).digest('hex') === payload.sha256;
    } catch { return false; }
  }
}
