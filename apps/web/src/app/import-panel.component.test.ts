import '@angular/compiler';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type {
  ApiService,
  ImportBatchDetail,
  ImportBatchHistoryPage,
  UploadWorkbookResponse,
} from './api.service';
import { ImportPanelComponent } from './import-panel.component';

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
  diagnostics: [
    {
      severity: 'warning',
      code: 'ROW_SKIPPED',
      message: 'Skipped Sheet1 row 3 because Date is missing or invalid.',
      phase: 'parse',
      sheetName: 'Sheet1',
      rowIndex: 3,
      sourceRecordId: '22222222-2222-4222-8222-222222222222',
      recordedAt: '2026-07-29T10:00:00.500Z',
    },
  ],
  diagnosticTotal: 1,
  diagnosticLimit: 100,
  diagnosticOffset: 0,
};

const uploadResult: UploadWorkbookResponse = {
  upload: {
    id: '33333333-3333-4333-8333-333333333333',
    filename: 'my-sport.xlsx',
    workbookKind: 'my_sport',
    byteSize: 1024,
    sha256: 'ab'.repeat(32),
    status: 'imported',
  },
  batches: [{ id: batch.id, filename: batch.filename, source: batch.source }],
  dailyRows: 2,
  activities: 13,
  performanceEvents: 0,
  warnings: ['one warning'],
};

const selectedFile = { name: 'my-sport.xlsx', size: 1024 } as File;

describe('ImportPanelComponent', () => {
  it('loads recent history on initialization', () => {
    const api = createApi();
    const component = new ImportPanelComponent(api as unknown as ApiService);

    component.ngOnInit();

    expect(api.importHistory).toHaveBeenCalledWith();
    expect(component.historyState()).toBe('loaded');
    expect(component.history()).toEqual([batch]);
  });

  it('loads a selected batch with source-row diagnostics', () => {
    const api = createApi();
    const component = new ImportPanelComponent(api as unknown as ApiService);

    component.selectBatch(batch);

    expect(api.importBatchDetail).toHaveBeenCalledWith(batch.id, 100, 0);
    expect(component.detailState()).toBe('loaded');
    expect(component.detail()?.diagnostics[0]).toMatchObject({ sheetName: 'Sheet1', rowIndex: 3 });
    expect(component.diagnosticLocation(detail.diagnostics[0]!)).toBe('Sheet1 row 3');
  });

  it('reports upload progress, refreshes history, and opens the recorded batch', () => {
    const api = createApi();
    api.uploadWorkbook.mockReturnValue(of(
      { type: HttpEventType.UploadProgress, loaded: 512, total: 1024 },
      new HttpResponse({ body: uploadResult }),
    ));
    const component = new ImportPanelComponent(api as unknown as ApiService);
    component.selectedFile = selectedFile;
    component.selectedFilename.set(selectedFile.name);

    component.import();

    expect(api.uploadWorkbook).toHaveBeenCalledWith(selectedFile, 'my_sport');
    expect(component.selectedFile).toBeNull();
    expect(component.uploadProgress()).toBe(100);
    expect(component.importMessage()).toContain('Uploaded my-sport.xlsx');
    expect(component.importMessage()).toContain('2 daily rows');
    expect(component.selectedBatchId()).toBe(batch.id);
  });

  it('requires a selected workbook before submitting', () => {
    const api = createApi();
    const component = new ImportPanelComponent(api as unknown as ApiService);

    component.import();

    expect(api.uploadWorkbook).not.toHaveBeenCalled();
    expect(component.importState()).toBe('error');
    expect(component.importMessage()).toContain('Choose an XLSX workbook');
  });

  it('shows duplicate guidance without exposing backend details', () => {
    const api = createApi();
    api.uploadWorkbook.mockReturnValue(
      throwError(() => new HttpErrorResponse({
        status: 409,
        error: {
          code: 'DUPLICATE_UPLOAD',
          message: 'backend detail /private/source.xlsx',
          duplicate: { filename: 'my-sport.xlsx', batchStatus: 'scored' },
        },
      })),
    );
    const component = new ImportPanelComponent(api as unknown as ApiService);
    component.selectedFile = selectedFile;

    component.import();

    expect(component.importState()).toBe('error');
    expect(component.importMessage()).toContain('already uploaded');
    expect(component.importMessage()).toContain('scored');
    expect(component.importMessage()).not.toContain('/private');
    expect(component.selectedFile).toBeNull();
  });

  it('appends bounded diagnostic pages', () => {
    const firstPage = { ...detail, diagnosticTotal: 2 };
    const secondDiagnostic = {
      ...detail.diagnostics[0]!,
      code: 'COLUMN_IGNORED',
      message: 'Ignored unknown column.',
      sheetName: null,
      rowIndex: null,
    };
    const api = createApi();
    api.importBatchDetail
      .mockReturnValueOnce(of(firstPage))
      .mockReturnValueOnce(of({ ...detail, diagnostics: [secondDiagnostic], diagnosticTotal: 2, diagnosticOffset: 1 }));
    const component = new ImportPanelComponent(api as unknown as ApiService);

    component.selectBatch(batch);
    component.loadMoreDiagnostics();

    expect(api.importBatchDetail).toHaveBeenLastCalledWith(batch.id, 100, 1);
    expect(component.detail()?.diagnostics).toHaveLength(2);
    expect(component.hasMoreDiagnostics()).toBe(false);
  });

  it('emits an affected date for Daily Log reconciliation', () => {
    const component = new ImportPanelComponent(createApi() as unknown as ApiService);
    const listener = vi.fn();
    component.reconcileDate.subscribe(listener);

    component.openReconciliation('2026-05-18');

    expect(listener).toHaveBeenCalledWith('2026-05-18');
  });
});

function createApi() {
  return {
    importHistory: vi.fn().mockReturnValue(of(historyPage)),
    importBatchDetail: vi.fn().mockReturnValue(of(detail)),
    uploadWorkbook: vi.fn().mockReturnValue(of(new HttpResponse({ body: uploadResult }))),
  };
}
