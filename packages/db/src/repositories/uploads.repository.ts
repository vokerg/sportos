import type { Kysely } from 'kysely';
import type { Database, NewUploadedFile, UploadedFile } from '../schema.js';

export type UploadedWorkbookKind = UploadedFile['workbook_kind'];

export interface UploadedFileDuplicateReadModel {
  uploadId: string;
  workbookKind: UploadedWorkbookKind;
  filename: string;
  byteSize: number;
  sha256: string;
  status: UploadedFile['status'];
  createdAt: string;
  batchId: string | null;
  batchStatus: Database['import_batches']['status'] | null;
}

export class UploadsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  create(input: NewUploadedFile): Promise<UploadedFile> {
    return this.db
      .insertInto('uploaded_files')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findDuplicate(sha256: string, workbookKind: UploadedWorkbookKind): Promise<UploadedFileDuplicateReadModel | null> {
    const upload = await this.db
      .selectFrom('uploaded_files')
      .selectAll()
      .where('sha256', '=', sha256)
      .where('workbook_kind', '=', workbookKind)
      .where('deleted_at', 'is', null)
      .where('status', '!=', 'deleted')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (!upload) return null;

    const batch = await this.db
      .selectFrom('import_batches')
      .select(['id', 'status'])
      .where('uploaded_file_id', '=', upload.id)
      .orderBy('started_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();

    return {
      uploadId: upload.id,
      workbookKind: upload.workbook_kind,
      filename: safeFilename(upload.sanitized_filename),
      byteSize: upload.byte_size,
      sha256: upload.sha256,
      status: upload.status,
      createdAt: timestampToIso(upload.created_at),
      batchId: batch?.id ?? null,
      batchStatus: batch?.status ?? null,
    };
  }

  async linkBatch(uploadId: string, batchId: string): Promise<void> {
    await this.db
      .updateTable('import_batches')
      .set({ uploaded_file_id: uploadId })
      .where('id', '=', batchId)
      .execute();
  }

  async markImported(uploadId: string): Promise<void> {
    await this.db
      .updateTable('uploaded_files')
      .set({ status: 'imported', imported_at: new Date(), last_error: null })
      .where('id', '=', uploadId)
      .execute();
  }

  async markFailed(uploadId: string, error: unknown): Promise<void> {
    const rawMessage = error instanceof Error ? error.message : String(error);
    await this.db
      .updateTable('uploaded_files')
      .set({
        status: 'failed',
        last_error: redactSensitiveText(rawMessage).slice(0, 500),
      })
      .where('id', '=', uploadId)
      .execute();
  }

  async markDeleted(uploadId: string): Promise<void> {
    await this.db
      .updateTable('uploaded_files')
      .set({ status: 'deleted', deleted_at: new Date() })
      .where('id', '=', uploadId)
      .execute();
  }
}

function safeFilename(filename: string): string {
  const value = filename.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)?.trim();
  return (value || 'workbook.xlsx').slice(0, 255);
}

function timestampToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
  }
  return String(value);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(["'`])(?:[A-Za-z]:[\\/]|\/)[^"'`\r\n]+\1/g, '$1[redacted local path]$1')
    .replace(/\b[A-Za-z]:[\\/][^\s,;]+/g, '[redacted local path]')
    .replace(/(^|\s)\/(?:[^/\s]+\/)*[^/\s,;]+/g, '$1[redacted local path]');
}
