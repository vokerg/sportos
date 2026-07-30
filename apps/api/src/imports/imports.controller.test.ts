import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportsController } from './imports.controller.js';
import type { ImportsService } from './imports.service.js';
import type { MultipartWorkbookFile } from './workbook-upload.js';

const batchId = '11111111-1111-4111-8111-111111111111';
const historyPage = { items: [], total: 0, limit: 20, offset: 0 };
const detailResponse = {
  batch: {
    id: batchId,
    source: 'my_sport_xlsx',
    sourceKind: 'xlsx',
    filename: 'my-sport.xlsx',
    status: 'scored',
    rowCount: 10,
    normalizedCount: 10,
    warningCount: 0,
    errorCount: 0,
    startedAt: '2026-07-29T10:00:00.000Z',
    completedAt: '2026-07-29T10:00:01.000Z',
    affectedDates: ['2026-07-28'],
    failure: null,
  },
  transitions: [],
  diagnostics: [],
  diagnosticTotal: 0,
  diagnosticLimit: 100,
  diagnosticOffset: 0,
};

const uploadFile: MultipartWorkbookFile = {
  originalname: 'my-sport.xlsx',
  mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: 4,
  buffer: Buffer.from('test'),
};

describe('ImportsController history and detail', () => {
  let service: {
    history: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    importLocalFiles: ReturnType<typeof vi.fn>;
    uploadWorkbook: ReturnType<typeof vi.fn>;
  };
  let controller: ImportsController;

  beforeEach(() => {
    service = {
      history: vi.fn(),
      detail: vi.fn(),
      importLocalFiles: vi.fn(),
      uploadWorkbook: vi.fn(),
    };
    controller = new ImportsController(service as unknown as ImportsService);
  });

  it('uses bounded history defaults and delegates to the query service', async () => {
    service.history.mockResolvedValue(historyPage);

    await expect(controller.history()).resolves.toEqual(historyPage);
    expect(service.history).toHaveBeenCalledWith(20, 0);
  });

  it('accepts explicit bounded pagination values', async () => {
    service.history.mockResolvedValue({ ...historyPage, limit: 50, offset: 100 });

    await controller.history('50', '100');

    expect(service.history).toHaveBeenCalledWith(50, 100);
  });

  it('rejects malformed or unbounded pagination before querying the database', async () => {
    for (const [limit, offset] of [['0', undefined], ['101', undefined], ['2.5', undefined], [undefined, '-1']]) {
      try {
        await controller.history(limit, offset);
        throw new Error('Expected invalid pagination to throw.');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
          code: 'INVALID_IMPORT_PAGINATION',
        });
      }
    }
    expect(service.history).not.toHaveBeenCalled();
  });

  it('delegates one multipart workbook and its explicit type', async () => {
    const response = { upload: { id: 'upload-id' }, batches: [] };
    service.uploadWorkbook.mockResolvedValue(response);

    await expect(controller.uploadWorkbook(uploadFile, 'my_sport')).resolves.toEqual(response);
    expect(service.uploadWorkbook).toHaveBeenCalledWith({ file: uploadFile, workbookKind: 'my_sport' });
  });

  it('returns a batch detail response with bounded diagnostic pagination', async () => {
    service.detail.mockResolvedValue(detailResponse);

    await expect(controller.detail(batchId, '25', '50')).resolves.toEqual(detailResponse);
    expect(service.detail).toHaveBeenCalledWith(batchId, 25, 50);
  });

  it('rejects malformed batch ids without querying the database', async () => {
    try {
      await controller.detail('not-a-uuid');
      throw new Error('Expected malformed id to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'INVALID_IMPORT_BATCH_ID',
        message: 'Import batch id must be a UUID.',
        batchId: 'not-a-uuid',
      });
    }
    expect(service.detail).not.toHaveBeenCalled();
  });

  it('returns an actionable not-found response for an unknown batch', async () => {
    service.detail.mockResolvedValue(null);

    try {
      await controller.detail(batchId);
      throw new Error('Expected missing batch to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'IMPORT_BATCH_NOT_FOUND',
        message: `No import batch exists with id ${batchId}.`,
        batchId,
      });
    }
  });

  it('keeps the existing local import command behind the service boundary', async () => {
    const result = { batches: [], dailyRows: 0, activities: 0, performanceEvents: 0, warnings: [] };
    service.importLocalFiles.mockResolvedValue(result);

    await expect(controller.importLocalFiles({ mySportPath: '/private/workbook.xlsx' })).resolves.toEqual(result);
    expect(service.importLocalFiles).toHaveBeenCalledWith({ mySportPath: '/private/workbook.xlsx' });
  });
});
