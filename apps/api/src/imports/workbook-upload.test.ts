import { readWorkbookBuffer } from '@sportos/importers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_WORKBOOK_UPLOAD_BYTES,
  validateWorkbookUpload,
  WorkbookUploadError,
  type MultipartWorkbookFile,
} from './workbook-upload.js';

vi.mock('@sportos/importers', () => ({
  readWorkbookBuffer: vi.fn(),
}));

const mockedReadWorkbookBuffer = vi.mocked(readWorkbookBuffer);

function file(overrides: Partial<MultipartWorkbookFile> = {}): MultipartWorkbookFile {
  return {
    originalname: '../private/My: Sport.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 4,
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    ...overrides,
  };
}

beforeEach(() => {
  mockedReadWorkbookBuffer.mockReset();
  mockedReadWorkbookBuffer.mockImplementation((bytes, filename) => ({
    filename,
    sha256: 'ab'.repeat(32),
    sheetNames: ['Sheet1'],
    rows: [],
    workbook: { SheetNames: ['Sheet1'], Sheets: {} },
  } as never));
});

describe('validateWorkbookUpload', () => {
  it('returns a safe filename and validated workbook extract', () => {
    const input = file();

    const result = validateWorkbookUpload(input, 'my_sport');

    expect(result).toMatchObject({
      workbookKind: 'my_sport',
      originalFilename: 'My: Sport.xlsx',
      sanitizedFilename: 'My- Sport.xlsx',
      byteSize: 4,
      sha256: 'ab'.repeat(32),
    });
    expect(result.bytes).toBe(input.buffer);
    expect(mockedReadWorkbookBuffer).toHaveBeenCalledWith(input.buffer, 'My- Sport.xlsx');
  });

  it.each([
    [undefined, 'my_sport', 'UPLOAD_FILE_REQUIRED'],
    [file(), 'other', 'INVALID_WORKBOOK_KIND'],
    [file({ originalname: 'workbook.xls' }), 'my_sport', 'UNSUPPORTED_FILE_EXTENSION'],
    [file({ mimetype: 'text/plain' }), 'my_sport', 'UNSUPPORTED_MEDIA_TYPE'],
    [file({ buffer: Buffer.alloc(0), size: 0 }), 'my_sport', 'EMPTY_UPLOAD'],
    [file({ buffer: Buffer.alloc(MAX_WORKBOOK_UPLOAD_BYTES + 1), size: MAX_WORKBOOK_UPLOAD_BYTES + 1 }), 'my_sport', 'UPLOAD_TOO_LARGE'],
    [file({ buffer: Buffer.from('not a zip') }), 'my_sport', 'INVALID_XLSX'],
  ])('rejects invalid input with stable code %s / %s', (input, kind, code) => {
    expect(() => validateWorkbookUpload(input as MultipartWorkbookFile | undefined, kind))
      .toThrow(expect.objectContaining({ code }));
  });

  it('returns INVALID_XLSX when the workbook parser rejects the ZIP', () => {
    mockedReadWorkbookBuffer.mockImplementation(() => {
      throw new Error('corrupt central directory');
    });

    expect(() => validateWorkbookUpload(file(), 'run_db')).toThrow(
      expect.objectContaining<Partial<WorkbookUploadError>>({ code: 'INVALID_XLSX' }),
    );
  });
});
