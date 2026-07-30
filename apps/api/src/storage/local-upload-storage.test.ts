import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalUploadStorage } from './local-upload-storage.js';

const uploadId = '11111111-1111-4111-8111-111111111111';
const sha256 = 'ab'.repeat(32);
const directories: string[] = [];

async function createStorage(): Promise<LocalUploadStorage> {
  const directory = await mkdtemp(join(tmpdir(), 'sportos-upload-storage-'));
  directories.push(directory);
  return new LocalUploadStorage(directory);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('LocalUploadStorage', () => {
  it('stores, reads, and deletes bytes behind an opaque object key', async () => {
    const storage = await createStorage();
    const bytes = Buffer.from('xlsx bytes');

    const stored = await storage.store({ uploadId, sha256, bytes });

    expect(stored).toEqual({ provider: 'local', objectKey: `ab/${uploadId}.xlsx` });
    await expect(storage.read(stored.objectKey)).resolves.toEqual(bytes);
    await expect(readFile(join(storage.rootDirectory, stored.objectKey))).resolves.toEqual(bytes);

    await storage.delete(stored.objectKey);
    await expect(storage.read(stored.objectKey)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects traversal, absolute paths, and malformed object keys', async () => {
    const storage = await createStorage();

    await expect(storage.read('../secret.xlsx')).rejects.toThrow('Invalid upload object key.');
    await expect(storage.read('/tmp/secret.xlsx')).rejects.toThrow('Invalid upload object key.');
    await expect(storage.read(`ab/${uploadId}.xls`)).rejects.toThrow('Invalid upload object key.');
  });

  it('requires a UUID and lowercase SHA-256 before writing', async () => {
    const storage = await createStorage();

    await expect(storage.store({ uploadId: 'not-a-uuid', sha256, bytes: Buffer.from('x') }))
      .rejects.toThrow('Upload id must be a UUID.');
    await expect(storage.store({ uploadId, sha256: sha256.toUpperCase(), bytes: Buffer.from('x') }))
      .rejects.toThrow('Upload SHA-256 must be lowercase hexadecimal.');
  });
});
