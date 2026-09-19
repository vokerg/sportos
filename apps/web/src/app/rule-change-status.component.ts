import { Component, input, output } from '@angular/core';
import type { RuleChange } from './features/rules/model/rules.models';

@Component({
  selector: 'sportos-rule-change-status',
  standalone: true,
  template: `
    @if (change(); as current) {
      <section class="change-status" aria-label="Active rule change">
        <h3>Active change</h3>
        <p>{{ current.status }} · {{ current.phase }} · {{ current.progressPercent }}% · attempt {{ current.attemptCount }}/{{ current.maxAttempts }}</p>
        @if (current.cancellationRequested && current.status === 'running') {
          <p>Cancellation requested at the next safe boundary.</p>
        }
        @if (current.error) {
          <p class="error">{{ current.error.code }}: {{ current.error.message }}</p>
        }
        <div class="actions">
          @if (current.status === 'queued' || current.status === 'running') {
            <button type="button" (click)="cancelRequested.emit()">Cancel</button>
          }
          @if (current.status === 'failed' && current.attemptCount < current.maxAttempts) {
            <button type="button" (click)="retryRequested.emit()">Retry</button>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    .change-status { margin-top: 16px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  `],
})
export class RuleChangeStatusComponent {
  readonly change = input<RuleChange | null>(null);
  readonly cancelRequested = output<void>();
  readonly retryRequested = output<void>();
}
