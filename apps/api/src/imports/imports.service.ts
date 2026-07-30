import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ImportsRepository, UploadsRepository } from '@sportos/db';
import { ImportService, type ImportLocalFilesInput, type ImportLocalFilesResult } from '@sportos/importers';
import { DbProvider } from '../db.provider.js';
import { UploadStorage } from '../storage/upload-storage.js';
import {
  validateWorkbookUpload,
  WorkbookUploadError,
  type MultipartWorkbookFile,
  type ValidatedWorkbookUpload,
} from './workbook-upload.js';

export interface UploadWorkbookInput {
  file?: MultipartWorkbookFile;
  workbookKind?: string;
}

export interface UploadWorkbookResponse extends ImportLocalFilesResult {
  upload: {
    id: string;
    filename: string;
    workbookKind: 'my_sport' | 'run_db';
    byteSize: number;
    sha256: string;
    status: 'imported';
  };
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DbProvider) private readonly dbProvider: DbProvider,
    @Inject(UploadStorage) private readonly uploadStorage: UploadStorage,
  ) {}

  importLocalFiles(input: ImportLocalFilesInput) {
    return new ImportService(this.dbProvider.db).importLocalFiles(input);
  }

  async uploadWorkbook(input: UploadWorkbookInput): Promise<UploadWorkbookResponse> {
    let validated: ValidatedWorkbookUpload;
    try {
      validated = validateWorkbookUpload(input.file, input.workbookKind);
    } catch (error) {
      if (error instanceof WorkbookUploadError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }

    const uploadsRepo = new UploadsRepository(this.dbProvider.db);
    const duplicate = await uploadsRepo.findDuplicate(validated.sha256, validated.workbookKind);
    if (duplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_UPLOAD',
        message: 'An identical workbook of this type has already been uploaded.',
        duplicate: {
          uploadId: duplicate.uploadId,
          filename: duplicate.filename,
          workbookKind: duplicate.workbookKind,
          status: duplicate.status,
          createdAt: duplicate.createdAt,
          batchId: duplicate.batchId,
          batchStatus: duplicate.batchStatus,
        },
      });
    }

    const uploadId = randomUUID();
    let objectKey: string | undefined;
    try {
      const stored = await this.uploadStorage.store({
        uploadId,
        sha256: validated.sha256,
        bytes: validated.bytes,
      });
      objectKey = stored.objectKey;
      await uploadsRepo.create({
        id: uploadId,
        workbook_kind: validated.workbookKind,
        storage_provider: stored.provider,
        object_key: stored.objectKey,
        original_filename: validated.originalFilename,
        sanitized_filename: validated.sanitizedFilename,
        content_type: validated.contentType,
        byte_size: validated.byteSize,
        sha256: validated.sha256,
        status: 'stored',
        last_error: null,
        imported_at: null,
        deleted_at: null,
      });
    } catch {
      if (objectKey) await this.uploadStorage.delete(objectKey).catch(() => undefined);
      throw new InternalServerErrorException({
        code: 'UPLOAD_STORAGE_FAILED',
        message: 'The workbook could not be stored. No import was started.',
      });
    }

    try {
      const result = await new ImportService(this.dbProvider.db).importWorkbook({
        workbookKind: validated.workbookKind,
        extract: validated.extract,
        uploadId,
      });
      await uploadsRepo.markImported(uploadId);
      return {
        ...result,
        upload: {
          id: uploadId,
          filename: validated.sanitizedFilename,
          workbookKind: validated.workbookKind,
          byteSize: validated.byteSize,
          sha256: validated.sha256,
          status: 'imported',
        },
      };
    } catch (error) {
      await uploadsRepo.markFailed(uploadId, error);
      throw new InternalServerErrorException({
        code: 'UPLOAD_IMPORT_FAILED',
        message: 'The workbook was stored, but its import failed. Review the newest failed batch for details.',
        uploadId,
      });
    }
  }

  history(limit: number, offset: number) {
    return new ImportsRepository(this.dbProvider.db).listBatches(limit, offset);
  }

  detail(batchId: string, diagnosticLimit: number, diagnosticOffset: number) {
    return new ImportsRepository(this.dbProvider.db).getBatchDetail(batchId, diagnosticLimit, diagnosticOffset);
  }
}
