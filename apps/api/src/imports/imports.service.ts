import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ActiveImportJobError,
  ImportJobsRepository,
  ImportJobStateError,
  ImportQueueFullError,
  ImportsRepository,
  UploadsRepository,
  type ImportJobReadModel,
} from '@sportos/db';
import { ImportService, type ImportLocalFilesInput } from '@sportos/importers';
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

export interface UploadWorkbookResponse {
  upload: {
    id: string;
    filename: string;
    workbookKind: 'my_sport' | 'run_db';
    byteSize: number;
    sha256: string;
    status: 'stored';
  };
  job: ImportJobReadModel;
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
        message: 'The workbook could not be stored. No import job was created.',
      });
    }

    let job: ImportJobReadModel;
    try {
      job = await new ImportJobsRepository(this.dbProvider.db).enqueue(uploadId);
    } catch (error) {
      if (objectKey) await this.uploadStorage.delete(objectKey).catch(() => undefined);
      await uploadsRepo.markDeleted(uploadId).catch(() => undefined);
      if (error instanceof ImportQueueFullError) {
        throw new ServiceUnavailableException({
          code: 'IMPORT_QUEUE_FULL',
          message: `The import queue is full (${error.limit} active jobs). Try again after a job completes.`,
        });
      }
      if (error instanceof ActiveImportJobError) {
        throw new ConflictException({
          code: 'ACTIVE_IMPORT_JOB_EXISTS',
          message: 'This upload already has an active import job.',
          jobId: error.jobId,
        });
      }
      throw new InternalServerErrorException({
        code: 'IMPORT_JOB_ENQUEUE_FAILED',
        message: 'The workbook was not queued. No import was started.',
      });
    }

    return {
      upload: {
        id: uploadId,
        filename: validated.sanitizedFilename,
        workbookKind: validated.workbookKind,
        byteSize: validated.byteSize,
        sha256: validated.sha256,
        status: 'stored',
      },
      job,
    };
  }

  async job(jobId: string): Promise<ImportJobReadModel> {
    const job = await new ImportJobsRepository(this.dbProvider.db).getById(jobId);
    if (!job) {
      throw new NotFoundException({
        code: 'IMPORT_JOB_NOT_FOUND',
        message: `No import job exists with id ${jobId}.`,
        jobId,
      });
    }
    return job;
  }

  async retryJob(jobId: string): Promise<ImportJobReadModel> {
    try {
      const job = await new ImportJobsRepository(this.dbProvider.db).retry(jobId);
      if (!job) throw new NotFoundException({ code: 'IMPORT_JOB_NOT_FOUND', message: `No import job exists with id ${jobId}.`, jobId });
      return job;
    } catch (error) {
      if (error instanceof ImportQueueFullError) {
        throw new ServiceUnavailableException({ code: 'IMPORT_QUEUE_FULL', message: 'The import queue is full. Try again later.' });
      }
      if (error instanceof ImportJobStateError) {
        throw new ConflictException({ code: error.code, message: error.message, jobId });
      }
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<ImportJobReadModel> {
    const job = await new ImportJobsRepository(this.dbProvider.db).requestCancellation(jobId);
    if (!job) {
      throw new NotFoundException({
        code: 'IMPORT_JOB_NOT_FOUND',
        message: `No import job exists with id ${jobId}.`,
        jobId,
      });
    }
    return job;
  }

  history(limit: number, offset: number) {
    return new ImportsRepository(this.dbProvider.db).listBatches(limit, offset);
  }

  detail(batchId: string, diagnosticLimit: number, diagnosticOffset: number) {
    return new ImportsRepository(this.dbProvider.db).getBatchDetail(batchId, diagnosticLimit, diagnosticOffset);
  }
}
