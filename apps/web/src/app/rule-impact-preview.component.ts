import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { RulePreviewResponse } from './api.service';
import { formatDate } from './date-time';
import { signedRuleDelta } from './rules-studio.view-model';

@Component({
  selector: 'sportos-rule-impact-preview',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (result(); as current) {
      <section class="preview">
        <h3>Preview</h3>
        <p><strong>{{ current.preview.changedDates }}</strong> of {{ current.preview.totalDates }} dates change; aggregate delta
          <strong>{{ signed(current.preview.aggregateDelta) }}</strong> points.</p>
        <p>Range recomputed: {{ formatRuleDate(current.preview.affectedFrom) }} → {{ formatRuleDate(current.preview.affectedTo) }}. No authoritative score has changed yet.</p>
        @if (current.preview.rows.length) {
          <div class="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Current</th><th>Proposed</th><th>Delta</th></tr></thead>
              <tbody>
                @for (row of current.preview.rows; track row.metricDate) {
                  <tr>
                    <td>{{ formatRuleDate(row.metricDate) }}</td>
                    <td>{{ row.currentTotalPoints }}</td>
                    <td>{{ row.proposedTotalPoints }}</td>
                    <td>{{ signed(row.delta) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        <label>Audit reason
          <input name="reason" [ngModel]="reason()" (ngModelChange)="reasonChange.emit($event)" placeholder="Why is this rule changing?">
        </label>
        <button type="button" (click)="activateRequested.emit()" [disabled]="loading() || !reason().trim()">
          Confirm and queue recomputation
        </button>
      </section>
    }
  `,
  styles: [`.preview { margin-top: 16px; }`],
})
export class RuleImpactPreviewComponent {
  readonly result = input<RulePreviewResponse | null>(null);
  readonly reason = input('');
  readonly loading = input(false);

  readonly reasonChange = output<string>();
  readonly activateRequested = output<void>();

  readonly formatRuleDate = formatDate;
  readonly signed = signedRuleDelta;
}
