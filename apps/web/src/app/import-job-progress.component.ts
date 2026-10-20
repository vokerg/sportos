import { Component, input, output } from '@angular/core';
import type { ImportJob } from './features/imports/model/imports.models';

@Component({
  selector: 'sportos-import-job-progress',
  standalone: true,
  template: `
    @if (job(); as current) {
      <section class="job-card" aria-label="Current import job">
        <div class="job-heading">
          <div>
            <strong>{{ current.filename }}</strong>
            <p>Attempt {{ current.attemptCount }} of {{ current.maxAttempts }} · {{ current.phase }}</p>
          </div>
          <span [class]="'status status-' + current.status">{{ current.status }}</span>
        </div>
        <div class="job-progress">
          <progress [value]="current.progressPercent" max="100"></progress>
          <span>{{ current.progressPercent }}%</span>
        </div>
        @if (current.cancellationRequested && current.status === 'running') {
          <p class="privacy-note">Cancellation requested. The worker will roll back at the next safe phase boundary.</p>
        }
        <div class="job-actions">
          @if ((current.status === 'queued' || current.status === 'running') && !current.cancellationRequested) {
            <button type="button" class="secondary" (click)="cancelRequested.emit()">Cancel job</button>
          }
          @if (current.status === 'failed' && current.attemptCount < current.maxAttempts) {
            <button type="button" class="secondary" (click)="retryRequested.emit()">Retry job</button>
          }
        </div>
      </section>
    }
    @if (message()) {
      <p class="request-message" [class.error-message]="error()" aria-live="polite">{{ message() }}</p>
    }
    <p class="developer-note">Status polling stops on a terminal state or after 120 checks. The server-local CLI remains available for development.</p>
  `,
  styles: [`
    .job-card { display: grid; gap: 10px; padding: 12px; border-radius: 12px; background: var(--accent-surface); }
    .job-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .job-heading p, .privacy-note, .developer-note { color: var(--text-muted); font-size: 13px; }
    .job-heading p, .privacy-note, .request-message, .developer-note { margin: 0; }
    .job-progress { display: flex; align-items: center; gap: 10px; }
    .job-progress progress { width: min(360px, 100%); }
    .job-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .secondary { background: var(--accent-surface); color: var(--link); }
    .error-message { color: var(--danger); }
    .status { display: inline-flex; padding: 3px 8px; border-radius: 999px; background: var(--surface-muted); color: var(--text-secondary); font-size: 11px; font-weight: 750; text-transform: uppercase; }
    .status-succeeded { background: var(--success-surface); color: var(--success); }
    .status-failed, .status-cancelled { background: var(--danger-surface); color: var(--danger); }
    .status-queued, .status-running { background: var(--warning-surface); color: var(--warning); }
  `],
})
export class ImportJobProgressComponent {
  readonly job = input<ImportJob | null>(null);
  readonly message = input<string | null>(null);
  readonly error = input(false);

  readonly cancelRequested = output<void>();
  readonly retryRequested = output<void>();
}
