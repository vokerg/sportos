import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ActivityType, RuleKind, RuleProposal } from './api.service';
import {
  RULE_ACTIVITY_TYPES,
  RULE_KINDS,
  metricOptionsFor,
  updateProposalActivity,
  updateProposalRuleKind,
} from './rules-studio.view-model';

@Component({
  selector: 'sportos-rule-proposal-editor',
  standalone: true,
  imports: [FormsModule],
  template: `
    <form class="grid editor" (ngSubmit)="previewRequested.emit()">
      <div class="grid two">
        <label>Stable code
          <input name="code" [ngModel]="proposal().code" (ngModelChange)="patch('code', $event)" [readonly]="!!proposal().replaceRuleId" required>
        </label>
        <label>Name
          <input name="name" [ngModel]="proposal().name" (ngModelChange)="patch('name', $event)" required>
        </label>
        <label>Activity
          <select name="activityType" [ngModel]="proposal().activityType" (ngModelChange)="activityChanged($event)">
            @for (value of activityTypes; track value) {
              <option [ngValue]="value">{{ value }}</option>
            }
          </select>
        </label>
        <label>Rule kind
          <select name="ruleKind" [ngModel]="proposal().ruleKind" (ngModelChange)="ruleKindChanged($event)">
            @for (value of ruleKinds; track value) {
              <option [ngValue]="value">{{ value }}</option>
            }
          </select>
        </label>
        <label>Metric
          <select name="metric" [ngModel]="proposal().metric" (ngModelChange)="patch('metric', $event)">
            @for (value of metricOptions(); track value) {
              <option [ngValue]="value">{{ value }}</option>
            }
          </select>
        </label>
        <label>Priority
          <input name="priority" type="number" min="0" max="10000" [ngModel]="proposal().priority" (ngModelChange)="patch('priority', $event)">
        </label>
        <label>Valid from
          <input name="validFrom" type="date" [ngModel]="proposal().validFrom" (ngModelChange)="patch('validFrom', $event)" required>
        </label>
        <label>Valid to
          <input name="validTo" type="date" [ngModel]="proposal().validTo" (ngModelChange)="patch('validTo', $event)">
        </label>
      </div>

      @if (proposal().ruleKind !== 'achievement') {
        <div class="grid two">
          <label>Coefficient
            <input name="coefficient" type="number" step="any" min="0" [ngModel]="proposal().coefficient" (ngModelChange)="patch('coefficient', $event)" required>
          </label>
        </div>
      } @else {
        <div class="grid two">
          <label>Operator
            <select name="thresholdOperator" [ngModel]="proposal().thresholdOperator" (ngModelChange)="patch('thresholdOperator', $event)">
              <option value="lt">lt</option><option value="lte">lte</option><option value="gt">gt</option>
              <option value="gte">gte</option><option value="eq">eq</option><option value="exists">exists</option>
            </select>
          </label>
          <label>Threshold
            <input name="thresholdValue" type="number" step="any" min="0" [ngModel]="proposal().thresholdValue" (ngModelChange)="patch('thresholdValue', $event)">
          </label>
          <label>Unit
            <input name="thresholdUnit" [ngModel]="proposal().thresholdUnit" (ngModelChange)="patch('thresholdUnit', $event)">
          </label>
          <label>Points
            <input name="points" type="number" min="1" step="1" [ngModel]="proposal().points" (ngModelChange)="patch('points', $event)">
          </label>
          <label>Achievement group
            <input name="achievementGroup" [ngModel]="proposal().achievementGroup" (ngModelChange)="patch('achievementGroup', $event)" placeholder="Optional highest-tier group">
          </label>
          <label>Points multiplier
            <select name="pointsMultiplier" [ngModel]="proposal().pointsMultiplier" (ngModelChange)="patch('pointsMultiplier', $event)">
              <option [ngValue]="undefined">None</option>
              <option value="completed_5k_blocks">Completed 5 km blocks</option>
              <option value="rounded_5k_blocks">Favourably rounded 5 km blocks</option>
            </select>
          </label>
        </div>
      }

      <label>Description
        <textarea name="description" rows="2" [ngModel]="proposal().description" (ngModelChange)="patch('description', $event)"></textarea>
      </label>
      <div><button type="submit" [disabled]="loading()">Preview impact</button></div>
    </form>
  `,
  styles: [`.editor { margin-top: 16px; }`],
})
export class RuleProposalEditorComponent {
  readonly proposal = input.required<RuleProposal>();
  readonly loading = input(false);

  readonly proposalChange = output<RuleProposal>();
  readonly previewRequested = output<void>();

  readonly activityTypes = RULE_ACTIVITY_TYPES;
  readonly ruleKinds = RULE_KINDS;

  metricOptions(): string[] {
    return metricOptionsFor(this.proposal().activityType);
  }

  activityChanged(activityType: ActivityType): void {
    this.proposalChange.emit(updateProposalActivity(this.proposal(), activityType));
  }

  ruleKindChanged(ruleKind: RuleKind): void {
    this.proposalChange.emit(updateProposalRuleKind(this.proposal(), ruleKind));
  }

  patch<K extends keyof RuleProposal>(key: K, value: RuleProposal[K]): void {
    this.proposalChange.emit({ ...this.proposal(), [key]: value });
  }
}
