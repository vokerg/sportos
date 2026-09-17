import {
  GarminCsvError,
  readGarminCsvBuffer,
  readWorkbookBuffer,
  type GarminCsvExtract,
  type ImportWorkbookKind,
  type WorkbookExtract,
} from '@sportos/importers';

export const MAX_WORKBOOK_UPLOAD_BYTES = 20 * 1024 * 1024;

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
]);

const CSV_MIME_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
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
  bytes: Buffer;
  sha256: string;
  extract: WorkbookExtract | GarminCsvExtract;
}

export type WorkbookUploadErrorCode =
  | 'UPLOAD_FILE_REQUIRED'
  | 'INVALID_WORKBOOK_KIND'
  | 'UNSUPPORTED_FILE_EXTENSION'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'EMPTY_UPLOAD'
  | 'UPLOAD_TOO_LARGE'
  | 'INVALID_XLSX'
  | 'INVALID_GARMIN_CSV'
  | 'UNSUPPORTED_GARMIN_REPORT'
  | 'GARMIN_CSV_TOO_MANY_ROWS';

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
  if (!file) throw new WorkbookUploadError('UPLOAD_FILE_REQUIRED', 'Choose a supported import file to upload.');

  const originalFilename = safeBasename(file.originalname, workbookKind === 'garmin_csv' ? 'garmin.csv' : 'workbook.xlsx');
  const expectedExtension = workbookKind === 'garmin_csv' ? '.csv' : '.xlsx';
  if (!originalFilename.toLowerCase().endsWith(expectedExtension)) {
    throw new WorkbookUploadError(
      'UNSUPPORTED_FILE_EXTENSION',
      workbookKind === 'garmin_csv' ? 'Garmin reports must be .csv files.' : 'Workbook imports must be .xlsx files.',
    );
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
  const allowedMimeTypes = workbookKind === 'garmin_csv' ? CSV_MIME_TYPES : XLSX_MIME_TYPES;
  if (!allowedMimeTypes.has(contentType)) {
    throw new WorkbookUploadError(
      'UNSUPPORTED_MEDIA_TYPE',
      workbookKind === 'garmin_csv'
        ? 'The uploaded file does not have a CSV-compatible media type.'
        : 'The uploaded file does not have an XLSX-compatible media type.',
    );
  }

  if (workbookKind !== 'garmin_csv' && (file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b)) {
    throw new WorkbookUploadError('INVALID_XLSX', 'The uploaded file is not an XLSX ZIP container.');
  }

  const sanitizedFilename = sanitizeFilename(originalFilename, expectedExtension);
  let extract: WorkbookExtract | GarminCsvExtract;
  try {
    extract = workbookKind === 'garmin_csv'
      ? readGarminCsvBuffer(file.buffer, sanitizedFilename)
      : readWorkbookBuffer(file.buffer, sanitizedFilename);
  } catch (error) {
    if (error instanceof GarminCsvError) {
      throw new WorkbookUploadError(error.code, error.message);
    }
    throw new WorkbookUploadError('INVALID_XLSX', 'The uploaded file could not be read as an XLSX workbook.');
  }
  if ('sheetNames' in extract && extract.sheetNames.length === 0) {
    throw new WorkbookUploadError('INVALID_XLSX', 'The uploaded workbook does not contain any worksheets.');
  }

  return {
    workbookKind,
    originalFilename,
    sanitizedFilename,
    contentType,
    byteSize,
    bytes: file.buffer,
    sha256: extract.sha256,
    extract,
  };
}

export function parseWorkbookKind(value: string | undefined): ImportWorkbookKind {
  if (value === 'my_sport' || value === 'run_db' || value === 'garmin_csv') return value;
  throw new WorkbookUploadError(
    'INVALID_WORKBOOK_KIND',
    "Import type must be 'my_sport', 'run_db', or 'garmin_csv'.",
  );
}

function safeBasename(filename: string, fallback: string): string {
  const value = String(filename || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.trim();
  return (value || fallback).slice(0, 255);
}

function sanitizeFilename(filename: string, extension: '.xlsx' | '.csv'): string {
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
