import { Component, input } from '@angular/core';
import type { RuleChange } from './api.service';
import { formatDate, formatDateTime } from './date-time';
import { ruleChangeResultSummary } from './rules-studio.view-model';

@Component({
  selector: 'sportos-rule-change-audit',
  standalone: true,
  template: `
    <section class="audit">
      <h3>Change audit</h3>
      @if (changes().length) {
        <div class="table-wrap">
          <table>
            <thead><tr><th>Created</th><th>Rule</th><th>Reason</th><th>Range</th><th>Status</th><th>Result</th></tr></thead>
            <tbody>
              @for (change of changes(); track change.id) {
                <tr>
                  <td>{{ formatTimestamp(change.createdAt) }}</td>
                  <td>{{ change.ruleCode }}</td>
                  <td>{{ change.reason }}</td>
                  <td>{{ formatRuleDate(change.affectedFrom) }} → {{ formatRuleDate(change.affectedTo) }}</td>
                  <td>{{ change.status }} · {{ change.phase }}</td>
                  <td>{{ change.error?.message || resultSummary(change) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p>No rule changes have been requested.</p>
      }
    </section>
  `,
  styles: [`.audit { margin-top: 16px; }`],
})
export class RuleChangeAuditComponent {
  readonly changes = input<RuleChange[]>([]);

  readonly formatRuleDate = formatDate;
  readonly formatTimestamp = formatDateTime;
  readonly resultSummary = ruleChangeResultSummary;
}
