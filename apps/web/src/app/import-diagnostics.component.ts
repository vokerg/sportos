import { Component, input, output } from '@angular/core';
import type { ImportDiagnostic } from './features/imports/model/imports.models';
import { importDiagnosticKey, importDiagnosticLocation } from './import-workflow.view-model';

@Component({
  selector: 'sportos-import-diagnostics',
  standalone: true,
  template: `
    <div class="diagnostic-heading">
      <h4>Diagnostics</h4>
      <span>{{ diagnostics().length }} of {{ total() }}</span>
    </div>
    @if (diagnostics().length === 0) {
      <p>No warnings or errors were recorded.</p>
    } @else {
      <ul class="diagnostic-list">
        @for (diagnostic of diagnostics(); track diagnosticKey(diagnostic)) {
          <li [class]="'diagnostic diagnostic-' + diagnostic.severity">
            <div class="diagnostic-title">
              <strong>{{ diagnostic.code }}</strong>
              <span>{{ diagnostic.severity }}</span>
            </div>
            <p>{{ diagnostic.message }}</p>
            <small>{{ diagnosticLocation(diagnostic) }} · {{ diagnostic.phase }}</small>
          </li>
        }
      </ul>
      @if (hasMore()) {
        <button type="button" class="secondary" (click)="loadMoreRequested.emit()" [disabled]="loadingMore()">
          {{ loadingMore() ? 'Loading…' : 'Load more diagnostics' }}
        </button>
      }
    }
  `,
  styles: [`
    .diagnostic-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .diagnostic-heading h4 { margin-bottom: 4px; }
    .diagnostic-heading span { color: #667085; font-size: 13px; }
    .diagnostic-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .diagnostic { padding: 10px; border-left: 4px solid #d97706; border-radius: 10px; background: #fffbeb; }
    .diagnostic-error { border-color: #dc2626; background: #fef2f2; }
    .diagnostic-title { display: flex; justify-content: space-between; gap: 8px; }
    .diagnostic p { margin: 5px 0; font-size: 13px; }
    .diagnostic small { color: #667085; }
    .secondary { margin-top: 8px; background: #e8eefc; color: #1d4ed8; }
  `],
})
export class ImportDiagnosticsComponent {
  readonly diagnostics = input<ImportDiagnostic[]>([]);
  readonly total = input(0);
  readonly hasMore = input(false);
  readonly loadingMore = input(false);

  readonly loadMoreRequested = output<void>();

  diagnosticLocation(diagnostic: ImportDiagnostic): string {
    return importDiagnosticLocation(diagnostic);
  }

  diagnosticKey(diagnostic: ImportDiagnostic): string {
    return importDiagnosticKey(diagnostic);
  }
}
