import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { UploadWorkbookKind } from './api.service';

@Component({
  selector: 'sportos-import-upload',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="upload-panel" aria-labelledby="upload-heading">
      <div>
        <h3 id="upload-heading">Upload workbook</h3>
        <p class="privacy-note">Maximum 20 MB. Upload returns after queueing; a separate worker performs the import.</p>
      </div>
      <div class="upload-fields">
        <label>
          Workbook type
          <select
            [ngModel]="workbookKind()"
            (ngModelChange)="setWorkbookKind($event)"
            name="workbookKind"
            [disabled]="loading()">
            <option value="my_sport">Daily ledger (my_sport)</option>
            <option value="run_db">Running performance database</option>
          </select>
        </label>
        <label>
          XLSX file
          <input
            #fileInput
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            (change)="selectFile($event)"
            [disabled]="loading()">
        </label>
      </div>
      @if (selectedFilename()) {
        <p class="selected-file">Selected: <strong>{{ selectedFilename() }}</strong></p>
      }
      <button type="button" (click)="uploadRequested.emit(fileInput)" [disabled]="loading() || !hasSelectedFile()">
        {{ loading() ? 'Upload or import in progress…' : 'Upload and queue' }}
      </button>
      @if (uploadProgress() !== null) {
        <div class="upload-progress" aria-live="polite">
          <progress [value]="uploadProgress()" max="100"></progress>
          <span>{{ uploadProgress() }}%</span>
        </div>
      }
    </section>
  `,
  styles: [`
    .upload-panel { display: grid; gap: 12px; border: 1px solid #dbe3f0; border-radius: 14px; padding: 14px; }
    .upload-panel h3 { margin-bottom: 4px; }
    .privacy-note { margin: 0; color: #667085; font-size: 13px; }
    .upload-fields { display: grid; grid-template-columns: minmax(180px, .8fr) minmax(220px, 1.4fr); gap: 12px; }
    .upload-fields label { display: grid; gap: 5px; font-size: 13px; font-weight: 650; }
    .upload-fields input, .upload-fields select { box-sizing: border-box; width: 100%; min-width: 0; }
    .selected-file { margin: 0; }
    .upload-progress { display: flex; align-items: center; gap: 10px; }
    .upload-progress progress { width: min(360px, 100%); }
    button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .6; }
    @media (max-width: 620px) { .upload-fields { grid-template-columns: 1fr; } }
  `],
})
export class ImportUploadComponent {
  readonly workbookKind = input<UploadWorkbookKind>('my_sport');
  readonly selectedFilename = input<string | null>(null);
  readonly uploadProgress = input<number | null>(null);
  readonly loading = input(false);
  readonly hasSelectedFile = input(false);

  readonly workbookKindChange = output<UploadWorkbookKind>();
  readonly fileSelected = output<File | null>();
  readonly uploadRequested = output<HTMLInputElement>();

  setWorkbookKind(value: UploadWorkbookKind): void {
    this.workbookKindChange.emit(value);
  }

  selectFile(event: Event): void {
    const inputElement = event.target as HTMLInputElement | null;
    this.fileSelected.emit(inputElement?.files?.item(0) ?? null);
  }
}
