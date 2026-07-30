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
