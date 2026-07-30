import { readWorkbookBuffer, type ImportWorkbookKind, type WorkbookExtract } from '@sportos/importers';

export const MAX_WORKBOOK_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
]);

export interface MultipartWorkbookFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface ValidatedWorkbookUpload {
  workbookKind: ImportWorkbookKind;
  originalFilename: string;
  sanitizedFilename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  extract: WorkbookExtract;
}

export type WorkbookUploadErrorCode =
  | 'UPLOAD_FILE_REQUIRED'
  | 'INVALID_WORKBOOK_KIND'
  | 'UNSUPPORTED_FILE_EXTENSION'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'EMPTY_UPLOAD'
  | 'UPLOAD_TOO_LARGE'
  | 'INVALID_XLSX';

export class WorkbookUploadError extends Error {
  constructor(
    readonly code: WorkbookUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkbookUploadError';
  }
}

export function validateWorkbookUpload(
  file: MultipartWorkbookFile | undefined,
  rawWorkbookKind: string | undefined,
): ValidatedWorkbookUpload {
  const workbookKind = parseWorkbookKind(rawWorkbookKind);
  if (!file) throw new WorkbookUploadError('UPLOAD_FILE_REQUIRED', 'Choose an XLSX workbook to upload.');

  const originalFilename = safeBasename(file.originalname);
  if (!/\.xlsx$/i.test(originalFilename)) {
    throw new WorkbookUploadError('UNSUPPORTED_FILE_EXTENSION', 'Only .xlsx workbooks are supported.');
  }

  const byteSize = file.buffer.length;
  if (byteSize === 0) throw new WorkbookUploadError('EMPTY_UPLOAD', 'The selected workbook is empty.');
  if (byteSize > MAX_WORKBOOK_UPLOAD_BYTES) {
    throw new WorkbookUploadError(
      'UPLOAD_TOO_LARGE',
      `The workbook exceeds the ${MAX_WORKBOOK_UPLOAD_BYTES / 1024 / 1024} MB upload limit.`,
    );
  }

  const contentType = String(file.mimetype || 'application/octet-stream').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    throw new WorkbookUploadError('UNSUPPORTED_MEDIA_TYPE', 'The uploaded file does not have an XLSX-compatible media type.');
  }

  if (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
    throw new WorkbookUploadError('INVALID_XLSX', 'The uploaded file is not an XLSX ZIP container.');
  }

  const sanitizedFilename = sanitizeFilename(originalFilename);
  let extract: WorkbookExtract;
  try {
    extract = readWorkbookBuffer(file.buffer, sanitizedFilename);
  } catch {
    throw new WorkbookUploadError('INVALID_XLSX', 'The uploaded file could not be read as an XLSX workbook.');
  }
  if (extract.sheetNames.length === 0) {
    throw new WorkbookUploadError('INVALID_XLSX', 'The uploaded workbook does not contain any worksheets.');
  }

  return {
    workbookKind,
    originalFilename,
    sanitizedFilename,
    contentType,
    byteSize,
    sha256: extract.sha256,
    extract,
  };
}

export function parseWorkbookKind(value: string | undefined): ImportWorkbookKind {
  if (value === 'my_sport' || value === 'run_db') return value;
  throw new WorkbookUploadError(
    'INVALID_WORKBOOK_KIND',
    "Workbook type must be 'my_sport' or 'run_db'.",
  );
}

function safeBasename(filename: string): string {
  const value = String(filename || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.trim();
  return (value || 'workbook.xlsx').slice(0, 255);
}

function sanitizeFilename(filename: string): string {
  const extension = '.xlsx';
  const stem = filename.slice(0, -extension.length)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 115);
  return `${stem || 'workbook'}${extension}`;
}
