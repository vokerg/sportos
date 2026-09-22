import { Component, EventEmitter } from '@angular/core';
import { ImportsStore } from './features/imports/state/imports.store';
import { ImportBatchDetailComponent } from './import-batch-detail.component';
import { ImportHistoryComponent } from './import-history.component';
import { ImportJobProgressComponent } from './import-job-progress.component';
import { ImportUploadComponent } from './import-upload.component';

@Component({
  selector: 'sportos-import-panel',
  standalone: true,
  imports: [
    ImportUploadComponent,
    ImportJobProgressComponent,
    ImportHistoryComponent,
    ImportBatchDetailComponent,
  ],
  outputs: ['reconcileDate'],
  template: `
    <section class="card import-card">
      <div class="section-heading">
        <div>
          <h2>Imports</h2>
          <p class="help">Upload a supported workbook or Garmin CSV, then follow its durable job, provenance batch, affected dates, and row diagnostics.</p>
        </div>
      </div>

      <sportos-import-upload
        [workbookKind]="store.workbookKind()"
        [selectedFilename]="store.selectedFilename()"
        [uploadProgress]="store.uploadProgress()"
        [loading]="store.importState() === 'loading'"
        [hasSelectedFile]="store.selectedFile() !== null"
        (workbookKindChange)="store.setWorkbookKind($event)"
        (fileSelected)="store.selectFile($event)"
        (uploadRequested)="startImport($event)" />

      <sportos-import-job-progress
        [job]="store.activeJob()"
        [message]="store.importMessage()"
        [error]="store.importState() === 'error'"
        (cancelRequested)="store.cancelActiveJob()"
        (retryRequested)="store.retryActiveJob()" />

      <sportos-import-history
        [state]="store.historyState()"
        [items]="store.history()"
        [total]="store.historyTotal()"
        [errorMessage]="store.historyError()"
        [selectedBatchId]="store.selectedBatchId()"
        (refreshRequested)="store.loadHistory()"
        (batchSelected)="store.selectBatch($event)" />

      <sportos-import-batch-detail
        [state]="store.detailState()"
        [detail]="store.detail()"
        [errorMessage]="store.detailError()"
        [loadingMoreDiagnostics]="store.loadingMoreDiagnostics()"
        (retryRequested)="store.retryDetail()"
        (reconcileDate)="openReconciliation($event)"
        (loadMoreDiagnosticsRequested)="store.loadMoreDiagnostics()" />
    </section>
  `,
  styles: [`
    .import-card { display: grid; gap: 16px; }
    .section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .section-heading h2 { margin-bottom: 4px; }
    .help { color: #667085; font-size: 13px; }
    @media (max-width: 620px) { .section-heading { align-items: stretch; flex-direction: column; } }
  `],
})
export class ImportPanelComponent {
  readonly reconcileDate = new EventEmitter<string>();

  constructor(readonly store: ImportsStore) {}

  startImport(fileInput: HTMLInputElement): void {
    if (this.store.startImport()) fileInput.value = '';
  }

  openReconciliation(date: string): void {
    this.reconcileDate.emit(date);
  }
}
