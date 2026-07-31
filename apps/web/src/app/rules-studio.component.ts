import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApiService,
  type ActivityType,
  type RuleChange,
  type RuleKind,
  type RulePreviewResponse,
  type RuleProposal,
  type RuleVersion,
} from './api.service';

@Component({
  selector: 'sportos-rules-studio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="card">
      <div class="toolbar">
        <div>
          <h2>Rules Studio</h2>
          <p>Preview deterministic score changes before activating an immutable rule version.</p>
        </div>
        <button type="button" (click)="startNewRule()">New rule family</button>
      </div>

      <p *ngIf="message()" [class.error]="state() === 'error'">{{ message() }}</p>

      <div class="table-wrap" *ngIf="rules().length; else noRules">
        <table>
          <thead><tr><th>Rule</th><th>Version</th><th>Effective</th><th>Formula</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr *ngFor="let rule of rules(); trackBy: trackRule">
              <td><strong>{{ rule.code }}</strong><br><small>{{ rule.name }}</small></td>
              <td>v{{ rule.version }}</td>
              <td>{{ rule.validFrom }} → {{ rule.validTo || 'open' }}</td>
              <td>{{ rule.metric }} · {{ formula(rule) }}</td>
              <td>{{ rule.enabled ? 'active' : 'pending/history' }}</td>
              <td><button type="button" [disabled]="!rule.enabled" (click)="editRule(rule)">Supersede</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <ng-template #noRules><p>No scoring rules are available.</p></ng-template>

      <form class="grid" (ngSubmit)="preview()" style="margin-top: 16px;">
        <div class="grid two">
          <label>Stable code<input name="code" [(ngModel)]="proposal.code" [readonly]="!!proposal.replaceRuleId" required></label>
          <label>Name<input name="name" [(ngModel)]="proposal.name" required></label>
          <label>Activity
            <select name="activityType" [(ngModel)]="proposal.activityType" (ngModelChange)="activityChanged()">
              <option *ngFor="let value of activityTypes" [ngValue]="value">{{ value }}</option>
            </select>
          </label>
          <label>Rule kind
            <select name="ruleKind" [(ngModel)]="proposal.ruleKind" (ngModelChange)="ruleKindChanged()">
              <option *ngFor="let value of ruleKinds" [ngValue]="value">{{ value }}</option>
            </select>
          </label>
          <label>Metric
            <select name="metric" [(ngModel)]="proposal.metric">
              <option *ngFor="let value of metricOptions()" [ngValue]="value">{{ value }}</option>
            </select>
          </label>
          <label>Priority<input name="priority" type="number" min="0" max="10000" [(ngModel)]="proposal.priority"></label>
          <label>Valid from<input name="validFrom" type="date" [(ngModel)]="proposal.validFrom" required></label>
          <label>Valid to<input name="validTo" type="date" [(ngModel)]="proposal.validTo"></label>
        </div>

        <div class="grid two" *ngIf="proposal.ruleKind !== 'achievement'; else achievementFields">
          <label>Coefficient<input name="coefficient" type="number" step="any" min="0" [(ngModel)]="proposal.coefficient" required></label>
        </div>
        <ng-template #achievementFields>
          <div class="grid two">
            <label>Operator
              <select name="thresholdOperator" [(ngModel)]="proposal.thresholdOperator">
                <option value="lt">lt</option><option value="lte">lte</option><option value="gt">gt</option>
                <option value="gte">gte</option><option value="eq">eq</option><option value="exists">exists</option>
              </select>
            </label>
            <label>Threshold<input name="thresholdValue" type="number" step="any" min="0" [(ngModel)]="proposal.thresholdValue"></label>
            <label>Unit<input name="thresholdUnit" [(ngModel)]="proposal.thresholdUnit"></label>
            <label>Points<input name="points" type="number" min="1" step="1" [(ngModel)]="proposal.points"></label>
          </div>
        </ng-template>

        <label>Description<textarea name="description" rows="2" [(ngModel)]="proposal.description"></textarea></label>
        <div><button type="submit" [disabled]="state() === 'loading'">Preview impact</button></div>
      </form>

      <section *ngIf="previewResult() as result" style="margin-top: 16px;">
        <h3>Preview</h3>
        <p><strong>{{ result.preview.changedDates }}</strong> of {{ result.preview.totalDates }} dates change; aggregate delta
          <strong>{{ signed(result.preview.aggregateDelta) }}</strong> points.</p>
        <p>Range recomputed: {{ result.preview.affectedFrom }} → {{ result.preview.affectedTo }}. No authoritative score has changed yet.</p>
        <div class="table-wrap" *ngIf="result.preview.rows.length">
          <table>
            <thead><tr><th>Date</th><th>Current</th><th>Proposed</th><th>Delta</th></tr></thead>
            <tbody><tr *ngFor="let row of result.preview.rows">
              <td>{{ row.metricDate }}</td><td>{{ row.currentTotalPoints }}</td><td>{{ row.proposedTotalPoints }}</td><td>{{ signed(row.delta) }}</td>
            </tr></tbody>
          </table>
        </div>
        <label>Audit reason<input name="reason" [(ngModel)]="reason" placeholder="Why is this rule changing?"></label>
        <button type="button" (click)="activate()" [disabled]="state() === 'loading' || !reason.trim()">Confirm and queue recomputation</button>
      </section>

      <section *ngIf="activeChange() as change" style="margin-top: 16px;">
        <h3>Active change</h3>
        <p>{{ change.status }} · {{ change.phase }} · {{ change.progressPercent }}% · attempt {{ change.attemptCount }}/{{ change.maxAttempts }}</p>
        <p *ngIf="change.error" class="error">{{ change.error.code }}: {{ change.error.message }}</p>
        <button type="button" *ngIf="change.status === 'queued' || change.status === 'running'" (click)="cancelActiveChange()">Cancel</button>
        <button type="button" *ngIf="change.status === 'failed' && change.attemptCount < change.maxAttempts" (click)="retryActiveChange()">Retry</button>
      </section>

      <section style="margin-top: 16px;">
        <h3>Change audit</h3>
        <div class="table-wrap" *ngIf="changes().length; else noChanges">
          <table><thead><tr><th>Created</th><th>Rule</th><th>Reason</th><th>Range</th><th>Status</th><th>Result</th></tr></thead>
          <tbody><tr *ngFor="let change of changes(); trackBy: trackChange">
            <td>{{ change.createdAt | date:'medium' }}</td><td>{{ change.ruleCode }}</td><td>{{ change.reason }}</td>
            <td>{{ change.affectedFrom }} → {{ change.affectedTo }}</td><td>{{ change.status }} · {{ change.phase }}</td>
            <td>{{ change.error?.message || resultSummary(change) }}</td>
          </tr></tbody></table>
        </div>
        <ng-template #noChanges><p>No rule changes have been requested.</p></ng-template>
      </section>
    </section>
  `,
})
export class RulesStudioComponent implements OnInit, OnDestroy {
  readonly rules = signal<RuleVersion[]>([]);
  readonly changes = signal<RuleChange[]>([]);
  readonly previewResult = signal<RulePreviewResponse | null>(null);
  readonly activeChange = signal<RuleChange | null>(null);
  readonly state = signal<'idle' | 'loading' | 'error'>('idle');
  readonly message = signal('');
  readonly activityTypes: ActivityType[] = ['steps', 'run', 'bike', 'swim', 'workout', 'rowing', 'sup', 'hiit', 'power_bonus'];
  readonly ruleKinds: RuleKind[] = ['coefficient', 'achievement', 'manual_points'];
  proposal: RuleProposal = newProposal();
  reason = '';
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollCount = 0;
  private readonly maximumPolls = 120;

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.refresh();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  refresh(): void {
    this.api.ruleVersions().subscribe({
      next: (rules) => this.rules.set(rules),
      error: (error) => this.fail(error),
    });
    this.api.ruleChanges().subscribe({
      next: (changes) => this.changes.set(changes),
      error: (error) => this.fail(error),
    });
  }

  startNewRule(): void {
    this.proposal = newProposal();
    this.previewResult.set(null);
    this.reason = '';
    this.message.set('Creating a new rule family.');
  }

  editRule(rule: RuleVersion): void {
    this.proposal = {
      replaceRuleId: rule.id,
      code: rule.code,
      name: rule.name,
      activityType: rule.activityType,
      ruleKind: rule.ruleKind,
      metric: rule.metric,
      coefficient: rule.coefficient,
      thresholdOperator: rule.thresholdOperator,
      thresholdValue: rule.thresholdValue,
      thresholdUnit: rule.thresholdUnit,
      points: rule.points,
      validFrom: todayIso(),
      validTo: undefined,
      priority: rule.priority,
      description: rule.description,
    };
    this.previewResult.set(null);
    this.reason = '';
    this.message.set(`Preparing a new version of ${rule.code}. Choose a cutover after ${rule.validFrom}.`);
  }

  activityChanged(): void {
    const metrics = this.metricOptions();
    if (!metrics.includes(this.proposal.metric)) this.proposal.metric = metrics[0] ?? '';
    this.syncThresholdUnit();
  }

  ruleKindChanged(): void {
    if (this.proposal.ruleKind === 'achievement') {
      this.proposal.coefficient = undefined;
      this.proposal.thresholdOperator = this.proposal.thresholdOperator ?? 'gte';
      this.proposal.thresholdValue = this.proposal.thresholdValue ?? 0;
      this.proposal.points = this.proposal.points ?? 1;
      this.syncThresholdUnit();
    } else {
      this.proposal.coefficient = this.proposal.coefficient ?? 1;
      this.proposal.thresholdOperator = undefined;
      this.proposal.thresholdValue = undefined;
      this.proposal.thresholdUnit = undefined;
      this.proposal.points = undefined;
    }
  }

  metricOptions(): string[] {
    if (this.proposal.activityType === 'steps') return ['steps'];
    if (['workout', 'hiit', 'power_bonus'].includes(this.proposal.activityType)) return ['effort_points'];
    return ['distance_m', 'distance_km', 'duration_s', 'avg_speed_mps', 'avg_speed_kmh'];
  }

  preview(): void {
    this.state.set('loading');
    this.message.set('Calculating a read-only preview…');
    this.previewResult.set(null);
    this.api.previewRule(cleanProposal(this.proposal)).subscribe({
      next: (result) => {
        this.proposal = { ...result.proposal };
        this.previewResult.set(result);
        this.state.set('idle');
        this.message.set('Preview complete. Review the date-level deltas before activation.');
      },
      error: (error) => this.fail(error),
    });
  }

  activate(): void {
    const preview = this.previewResult();
    if (!preview || !this.reason.trim()) return;
    this.state.set('loading');
    this.api.activateRule(preview.proposal, preview.previewFingerprint, this.reason).subscribe({
      next: (change) => {
        this.activeChange.set(change);
        this.state.set('idle');
        this.message.set('Rule change queued. Authoritative rules and scores remain unchanged until the worker transaction succeeds.');
        this.pollCount = 0;
        this.schedulePoll();
        this.refresh();
      },
      error: (error) => this.fail(error),
    });
  }

  cancelActiveChange(): void {
    const change = this.activeChange();
    if (!change) return;
    this.api.cancelRuleChange(change.id).subscribe({
      next: (updated) => {
        this.activeChange.set(updated);
        this.message.set(updated.status === 'cancelled' ? 'Queued rule change cancelled.' : 'Cancellation requested at the next safe boundary.');
      },
      error: (error) => this.fail(error),
    });
  }

  retryActiveChange(): void {
    const change = this.activeChange();
    if (!change) return;
    this.api.retryRuleChange(change.id).subscribe({
      next: (updated) => {
        this.activeChange.set(updated);
        this.pollCount = 0;
        this.message.set('Rule change requeued with the same audit identity.');
        this.schedulePoll();
      },
      error: (error) => this.fail(error),
    });
  }

  formula(rule: Pick<RuleVersion, 'ruleKind' | 'coefficient' | 'thresholdOperator' | 'thresholdValue' | 'thresholdUnit' | 'points'>): string {
    if (rule.ruleKind === 'achievement') return `${rule.thresholdOperator} ${rule.thresholdValue ?? ''} ${rule.thresholdUnit ?? ''} → +${rule.points ?? 0}`;
    return `× ${rule.coefficient ?? 0}`;
  }

  signed(value: number): string {
    return value > 0 ? `+${value}` : String(value);
  }

  resultSummary(change: RuleChange): string {
    const result = change.result as { datesRecomputed?: number } | null;
    return result?.datesRecomputed === undefined ? '' : `${result.datesRecomputed} dates recomputed`;
  }

  trackRule(_: number, rule: RuleVersion): string { return rule.id; }
  trackChange(_: number, change: RuleChange): string { return change.id; }

  private schedulePoll(): void {
    this.stopPolling();
    const change = this.activeChange();
    if (!change || terminal(change) || this.pollCount >= this.maximumPolls) {
      if (this.pollCount >= this.maximumPolls && change && !terminal(change)) {
        this.message.set('Automatic monitoring stopped after 120 checks. Refresh Rules Studio to inspect the durable job state.');
      }
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollCount += 1;
      this.api.ruleChange(change.id).subscribe({
        next: (updated) => {
          this.activeChange.set(updated);
          if (terminal(updated)) {
            this.stopPolling();
            this.message.set(updated.status === 'succeeded'
              ? 'Rule version activated and affected scores recomputed atomically.'
              : `Rule change finished with status ${updated.status}.`);
            this.refresh();
          } else {
            this.schedulePoll();
          }
        },
        error: (error) => this.fail(error),
      });
    }, 1500);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private syncThresholdUnit(): void {
    this.proposal.thresholdUnit = metricUnit(this.proposal.metric);
  }

  private fail(error: unknown): void {
    this.state.set('error');
    this.message.set(errorMessage(error));
  }
}

function newProposal(): RuleProposal {
  return {
    code: 'run.distance.custom',
    name: 'Custom run distance',
    activityType: 'run',
    ruleKind: 'coefficient',
    metric: 'distance_km',
    coefficient: 1000,
    validFrom: todayIso(),
    priority: 100,
  };
}

function cleanProposal(proposal: RuleProposal): RuleProposal {
  return {
    ...proposal,
    validTo: proposal.validTo || undefined,
    description: proposal.description?.trim() || undefined,
  };
}

function metricUnit(metric: string): string {
  switch (metric) {
    case 'steps': return 'steps';
    case 'distance_m': return 'm';
    case 'distance_km': return 'km';
    case 'duration_s': return 's';
    case 'avg_speed_mps': return 'm/s';
    case 'avg_speed_kmh': return 'km/h';
    case 'effort_points': return 'points';
    default: return 'units';
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function terminal(change: RuleChange): boolean {
  return change.status === 'succeeded' || change.status === 'failed' || change.status === 'cancelled';
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: string; issues?: Array<{ message?: string }> } | null;
    if (body?.issues?.length) return body.issues.map((issue) => issue.message).filter(Boolean).join(' ');
    if (body?.message) return body.message;
  }
  return error instanceof Error ? error.message : 'Rules Studio request failed.';
}
