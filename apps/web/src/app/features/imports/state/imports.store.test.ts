import '@angular/compiler';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportsApiService } from '../data-access/imports-api.service';
import type {
  ImportBatchDetail,
  ImportBatchHistoryPage,
  ImportJob,
  UploadWorkbookResponse,
} from '../model/imports.models';
import { ImportsStore } from './imports.store';

const batch = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'my_sport_xlsx',
  sourceKind: 'xlsx' as const,
  filename: 'my-sport.xlsx',
  status: 'scored' as const,
  rowCount: 3,
  normalizedCount: 2,
  warningCount: 1,
  errorCount: 0,
  startedAt: '2026-07-29T10:00:00.000Z',
  completedAt: '2026-07-29T10:00:01.000Z',
  affectedDates: ['2026-05-18'],
  failure: null,
};

const historyPage: ImportBatchHistoryPage = {
  items: [batch],
  total: 1,
  limit: 20,
  offset: 0,
};

const detail: ImportBatchDetail = {
  batch,
  transitions: [
    { status: 'started', phase: 'batch-created', recordedAt: '2026-07-29T10:00:00.000Z' },
    { status: 'scored', phase: 'daily-scored', recordedAt: '2026-07-29T10:00:01.000Z' },
  ],
  diagnostics: [{
    severity: 'warning',
    code: 'ROW_SKIPPED',
    message: 'Skipped Sheet1 row 3 because Date is missing or invalid.',
    phase: 'parse',
    sheetName: 'Sheet1',
    rowIndex: 3,
    sourceRecordId: '22222222-2222-4222-8222-222222222222',
    recordedAt: '2026-07-29T10:00:00.500Z',
  }],
  diagnosticTotal: 1,
  diagnosticLimit: 100,
  diagnosticOffset: 0,
};

const queuedJob: ImportJob = {
  id: '44444444-4444-4444-8444-444444444444',
  uploadId: '33333333-3333-4333-8333-333333333333',
  batchId: null,
  filename: 'my-sport.xlsx',
  workbookKind: 'my_sport',
  uploadStatus: 'stored',
  status: 'queued',
  phase: 'queued',
  progressPercent: 0,
  attemptCount: 0,
  maxAttempts: 3,
  cancellationRequested: false,
  error: null,
  result: {},
  createdAt: '2026-07-29T10:00:00.000Z',
  updatedAt: '2026-07-29T10:00:00.000Z',
  startedAt: null,
  completedAt: null,
};

const succeededJob: ImportJob = {
  ...queuedJob,
  batchId: batch.id,
  uploadStatus: 'imported',
  status: 'succeeded',
  phase: 'completed',
  progressPercent: 100,
  attemptCount: 1,
  result: { dailyRows: 2, activities: 13, performanceEvents: 0, warnings: ['one warning'] },
  startedAt: '2026-07-29T10:00:00.100Z',
  completedAt: '2026-07-29T10:00:01.000Z',
};

const uploadResult: UploadWorkbookResponse = {
  upload: {
    id: queuedJob.uploadId,
    filename: 'my-sport.xlsx',
    workbookKind: 'my_sport',
    byteSize: 1024,
    sha256: 'ab'.repeat(32),
    status: 'stored',
  },
  job: queuedJob,
};

const selectedFile = { name: 'my-sport.xlsx', size: 1024 } as File;

afterEach(() => {
  vi.useRealTimers();
});

describe('ImportsStore', () => {
  it('initializes recent import history once', () => {
    const api = createApi();
    const store = new ImportsStore(api as unknown as ImportsApiService);

    store.initialize();
    store.initialize();

    expect(api.importHistory).toHaveBeenCalledTimes(1);
    expect(store.historyState()).toBe('loaded');
    expect(store.history()).toEqual([batch]);
    store.ngOnDestroy();
  });

  it('tracks upload progress separately and follows the durable job to success', async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.uploadWorkbook.mockReturnValue(of(
      { type: HttpEventType.UploadProgress, loaded: 512, total: 1024 },
      new HttpResponse({ body: uploadResult }),
    ));
    api.importJob.mockReturnValue(of(succeededJob));
    const store = new ImportsStore(api as unknown as ImportsApiService);
    store.selectFile(selectedFile);

    expect(store.startImport()).toBe(true);
    expect(store.selectedFile()).toBeNull();

    await vi.runAllTimersAsync();

    expect(api.uploadWorkbook).toHaveBeenCalledWith(selectedFile, 'my_sport');
    expect(api.importJob).toHaveBeenCalledWith(queuedJob.id);
    expect(store.uploadProgress()).toBeNull();
    expect(store.activeJob()?.status).toBe('succeeded');
    expect(store.importMessage()).toContain('2 daily rows');
    expect(store.selectedBatchId()).toBe(batch.id);
    store.ngOnDestroy();
  });

  it('requests cooperative cancellation and continues monitoring an active cancellation', async () => {
    vi.useFakeTimers();
    const running = { ...queuedJob, status: 'running' as const, phase: 'raw-stored', progressPercent: 45, attemptCount: 1 };
    const cancelling = { ...running, phase: 'cancelling', cancellationRequested: true };
    const api = createApi();
    api.cancelImportJob.mockReturnValue(of(cancelling));
    api.importJob.mockReturnValue(of(succeededJob));
    const store = new ImportsStore(api as unknown as ImportsApiService);
    store.activeJob.set(running);

    store.cancelActiveJob();

    expect(api.cancelImportJob).toHaveBeenCalledWith(running.id);
    expect(store.activeJob()?.cancellationRequested).toBe(true);
    expect(store.importMessage()).toContain('safe phase boundary');

    await vi.runAllTimersAsync();
    expect(store.activeJob()?.status).toBe('succeeded');
    store.ngOnDestroy();
  });

  it('retries a failed job and resumes bounded polling', async () => {
    vi.useFakeTimers();
    const failed = {
      ...queuedJob,
      status: 'failed' as const,
      phase: 'failed',
      attemptCount: 1,
      error: { code: 'ERROR', message: 'sanitized failure' },
    };
    const api = createApi();
    api.retryImportJob.mockReturnValue(of(queuedJob));
    api.importJob.mockReturnValue(of(succeededJob));
    const store = new ImportsStore(api as unknown as ImportsApiService);
    store.activeJob.set(failed);

    store.retryActiveJob();
    await vi.runAllTimersAsync();

    expect(api.retryImportJob).toHaveBeenCalledWith(failed.id);
    expect(store.activeJob()?.status).toBe('succeeded');
    store.ngOnDestroy();
  });

  it('normalizes upload errors without exposing backend storage details', () => {
    const api = createApi();
    api.uploadWorkbook.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 409,
      error: {
        code: 'DUPLICATE_UPLOAD',
        message: 'backend detail /private/source.xlsx',
        duplicate: { filename: 'my-sport.xlsx', batchStatus: 'scored' },
      },
    })));
    const store = new ImportsStore(api as unknown as ImportsApiService);
    store.selectFile(selectedFile);

    store.startImport();

    expect(store.importState()).toBe('error');
    expect(store.importMessage()).toContain('already uploaded');
    expect(store.importMessage()).not.toContain('/private');
    expect(store.selectedFile()).toBeNull();
    store.ngOnDestroy();
  });
});

function createApi() {
  return {
    importHistory: vi.fn().mockReturnValue(of(historyPage)),
    importBatchDetail: vi.fn().mockReturnValue(of(detail)),
    uploadWorkbook: vi.fn().mockReturnValue(of(new HttpResponse({ body: uploadResult }))),
    importJob: vi.fn().mockReturnValue(of(succeededJob)),
    retryImportJob: vi.fn().mockReturnValue(of(queuedJob)),
    cancelImportJob: vi.fn().mockReturnValue(of({ ...queuedJob, status: 'cancelled' as const, phase: 'cancelled' })),
  };
}
