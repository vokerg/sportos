import '@angular/compiler';
import {
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { describe, expect, it } from 'vitest';
import type { ImportBatchHistoryItem } from './api.service';
import { ImportBatchDetailComponent } from './import-batch-detail.component';
import { ImportDiagnosticsComponent } from './import-diagnostics.component';
import { ImportHistoryComponent } from './import-history.component';
import { ImportJobProgressComponent } from './import-job-progress.component';
import { ImportUploadComponent } from './import-upload.component';

const batch: ImportBatchHistoryItem = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'my_sport_xlsx',
  sourceKind: 'xlsx',
  filename: 'my-sport.xlsx',
  status: 'scored',
  rowCount: 3,
  normalizedCount: 2,
  warningCount: 1,
  errorCount: 0,
  startedAt: '2026-07-29T10:00:00.000Z',
  completedAt: '2026-07-29T10:00:01.000Z',
  affectedDates: ['2026-05-18'],
  failure: null,
};

describe('import presentation components', () => {
  it('emits upload selection and workbook intents without API dependencies', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const upload = runInInjectionContext(injector, () => new ImportUploadComponent());
    const selectedFile = { name: 'my-sport.xlsx', size: 1024 } as File;
    const kinds: string[] = [];
    const files: Array<File | null> = [];

    upload.workbookKindChange.subscribe((value) => kinds.push(value));
    upload.fileSelected.subscribe((value) => files.push(value));

    upload.setWorkbookKind('run_db');
    upload.selectFile({
      target: { files: { item: () => selectedFile } },
    } as unknown as Event);

    expect(kinds).toEqual(['run_db']);
    expect(files).toEqual([selectedFile]);
    expect(upload.uploadProgress()).toBeNull();
    injector.destroy();
  });

  it('exposes job, history, detail, and diagnostics actions as typed user intents', () => {
    const injector = createEnvironmentInjector([], Injector.NULL as unknown as EnvironmentInjector);
    const { job, history, detail, diagnostics } = runInInjectionContext(injector, () => ({
      job: new ImportJobProgressComponent(),
      history: new ImportHistoryComponent(),
      detail: new ImportBatchDetailComponent(),
      diagnostics: new ImportDiagnosticsComponent(),
    }));
    const intents: string[] = [];

    job.cancelRequested.subscribe(() => intents.push('cancel'));
    job.retryRequested.subscribe(() => intents.push('retry-job'));
    history.refreshRequested.subscribe(() => intents.push('refresh'));
    history.batchSelected.subscribe((selected) => intents.push(`batch:${selected.id}`));
    detail.retryRequested.subscribe(() => intents.push('retry-detail'));
    detail.reconcileDate.subscribe((date) => intents.push(`date:${date}`));
    detail.loadMoreDiagnosticsRequested.subscribe(() => intents.push('load-more-detail'));
    diagnostics.loadMoreRequested.subscribe(() => intents.push('load-more-diagnostics'));

    job.cancelRequested.emit();
    job.retryRequested.emit();
    history.refreshRequested.emit();
    history.batchSelected.emit(batch);
    detail.retryRequested.emit();
    detail.reconcileDate.emit('2026-05-18');
    detail.loadMoreDiagnosticsRequested.emit();
    diagnostics.loadMoreRequested.emit();

    expect(intents).toEqual([
      'cancel',
      'retry-job',
      'refresh',
      `batch:${batch.id}`,
      'retry-detail',
      'date:2026-05-18',
      'load-more-detail',
      'load-more-diagnostics',
    ]);
    expect(history.items()).toEqual([]);
    expect(detail.detail()).toBeNull();
    expect(diagnostics.diagnostics()).toEqual([]);
    injector.destroy();
  });
});
