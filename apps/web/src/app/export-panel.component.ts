import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService, type CanonicalExportBundle } from './api.service';

type ExportState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'sportos-export-panel',
  standalone: true,
  template: `
    <section class="card" aria-labelledby="export-title">
      <h2 id="export-title">Canonical export</h2>
      <p class="help">Download versioned canonical daily, activity, performance, reconciliation, and provenance data. Raw workbook cells, formulas, upload hashes, storage keys, and server paths are excluded.</p>
      <form class="filter-bar" (submit)="export(); $event.preventDefault()" aria-label="Canonical export range">
        <label>From <input type="date" required [value]="from()" (input)="from.set($any($event.target).value)" /></label>
        <label>To <input type="date" required [value]="to()" (input)="to.set($any($event.target).value)" /></label>
        <button type="submit" [disabled]="state() === 'loading'">Download JSON</button>
      </form>
      @if (state() === 'loading') {
        <p role="status" aria-live="polite">Building canonical export…</p>
      } @else if (state() === 'error') {
        <p class="state-message error" role="alert">{{ errorMessage() }}</p>
      } @else if (state() === 'ready' && lastBundle()) {
        <p class="state-message" role="status">
          Downloaded {{ lastBundle()!.schemaVersion }}: {{ lastBundle()!.rowCounts.dailySummaries }} daily rows,
          {{ lastBundle()!.rowCounts.activities }} activities, and {{ lastBundle()!.rowCounts.performanceEvents }} performance events.
        </p>
      }
    </section>
  `,
  styles: [`.help { margin: -6px 0 16px; color: #667085; font-size: 13px; }`],
})
export class ExportPanelComponent implements OnDestroy {
  readonly from = signal(defaultFrom());
  readonly to = signal(today());
  readonly state = signal<ExportState>('idle');
  readonly errorMessage = signal<string | null>(null);
  readonly lastBundle = signal<CanonicalExportBundle | null>(null);

  private subscription?: Subscription;

  constructor(private readonly api: ApiService) {}

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  export(): void {
    if (!this.from() || !this.to()) {
      this.errorMessage.set('Choose both a from and to date.');
      this.state.set('error');
      return;
    }
    if (this.from() > this.to()) {
      this.errorMessage.set('From date must be on or before the to date.');
      this.state.set('error');
      return;
    }
    this.subscription?.unsubscribe();
    this.state.set('loading');
    this.errorMessage.set(null);
    this.subscription = this.api.canonicalExport(this.from(), this.to()).subscribe({
      next: (bundle) => {
        this.lastBundle.set(bundle);
        this.download(bundle);
        this.state.set('ready');
      },
      error: (error: unknown) => {
        this.errorMessage.set(this.describeError(error));
        this.state.set('error');
      },
    });
  }

  serialize(bundle: CanonicalExportBundle): string {
    return `${JSON.stringify(bundle, null, 2)}\n`;
  }

  private download(bundle: CanonicalExportBundle): void {
    const blob = new Blob([this.serialize(bundle)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sportos-canonical-${bundle.dateRange.from}-${bundle.dateRange.to}.json`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private describeError(error: unknown): string {
    if (!(error instanceof HttpErrorResponse)) return 'The canonical export request failed unexpectedly.';
    const body = error.error && typeof error.error === 'object' ? error.error as { message?: string } : null;
    if (error.status === 0) return 'The SportOS API is unavailable. Check that the local API is running.';
    return body?.message || `The canonical export API returned HTTP ${error.status}.`;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultFrom(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}
