import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export interface StoreUploadInput {
  uploadId: string;
  sha256: string;
  bytes: Uint8Array;
}

export interface StoredUploadObject {
  provider: 'local';
  objectKey: string;
}

export abstract class UploadStorage {
  abstract store(input: StoreUploadInput): Promise<StoredUploadObject>;
  abstract read(objectKey: string): Promise<Buffer>;
  abstract delete(objectKey: string): Promise<void>;
}

const OBJECT_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.xlsx$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class LocalUploadStorage extends UploadStorage {
  readonly rootDirectory: string;

  constructor(rootDirectory = process.env.SPORTOS_UPLOAD_DIR ?? './data/uploads') {
    super();
    this.rootDirectory = resolve(rootDirectory);
  }

  async store(input: StoreUploadInput): Promise<StoredUploadObject> {
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new Error('Upload SHA-256 must be lowercase hexadecimal.');
    if (!UUID_PATTERN.test(input.uploadId)) throw new Error('Upload id must be a UUID.');

    const objectKey = `${input.sha256.slice(0, 2)}/${input.uploadId}.xlsx`;
    const target = this.objectPath(objectKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.bytes, { flag: 'wx', mode: 0o600 });
    return { provider: 'local', objectKey };
  }

  async read(objectKey: string): Promise<Buffer> {
    return readFile(this.objectPath(objectKey));
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.objectPath(objectKey), { force: true });
  }

  private objectPath(objectKey: string): string {
    if (!OBJECT_KEY_PATTERN.test(objectKey)) throw new Error('Invalid upload object key.');
    const target = resolve(this.rootDirectory, objectKey);
    if (target !== this.rootDirectory && !target.startsWith(`${this.rootDirectory}${sep}`)) {
      throw new Error('Upload object key escapes the storage root.');
    }
    return target;
  }
}
