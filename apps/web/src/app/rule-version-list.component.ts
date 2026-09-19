import { Component, input, output } from '@angular/core';
import type { RuleVersion } from './features/rules/model/rules.models';
import { formatDate } from './date-time';
import { ruleFormula } from './rules-studio.view-model';

@Component({
  selector: 'sportos-rule-version-list',
  standalone: true,
  template: `
    @if (rules().length) {
      <div class="table-wrap">
        <table>
          <thead><tr><th>Rule</th><th>Version</th><th>Effective</th><th>Formula</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (rule of rules(); track rule.id) {
              <tr>
                <td><strong>{{ rule.code }}</strong><br><small>{{ rule.name }}</small></td>
                <td>v{{ rule.version }}</td>
                <td>{{ formatRuleDate(rule.validFrom) }} → {{ rule.validTo ? formatRuleDate(rule.validTo) : 'open' }}</td>
                <td>{{ rule.metric }} · {{ formula(rule) }}</td>
                <td>{{ rule.enabled ? 'active' : 'pending/history' }}</td>
                <td><button type="button" [disabled]="!rule.enabled" (click)="editRequested.emit(rule)">Supersede</button></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <p>No scoring rules are available.</p>
    }
  `,
})
export class RuleVersionListComponent {
  readonly rules = input<RuleVersion[]>([]);
  readonly editRequested = output<RuleVersion>();

  readonly formatRuleDate = formatDate;
  readonly formula = ruleFormula;
}
