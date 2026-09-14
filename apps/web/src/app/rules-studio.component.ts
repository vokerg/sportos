import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import {
  ApiService,
  type RuleChange,
  type RulePreviewResponse,
  type RuleProposal,
  type RuleVersion,
} from './api.service';
import { formatDate } from './date-time';
import { RuleChangeAuditComponent } from './rule-change-audit.component';
import { RuleChangeStatusComponent } from './rule-change-status.component';
import { RuleImpactPreviewComponent } from './rule-impact-preview.component';
import { RuleProposalEditorComponent } from './rule-proposal-editor.component';
import { RuleVersionListComponent } from './rule-version-list.component';
import {
  cleanRuleProposal,
  describeRuleRequestError,
  isTerminalRuleChange,
  newRuleProposal,
  proposalFromRule,
} from './rules-studio.view-model';

@Component({
  selector: 'sportos-rules-studio',
  standalone: true,
  imports: [
    RuleVersionListComponent,
    RuleProposalEditorComponent,
    RuleImpactPreviewComponent,
    RuleChangeStatusComponent,
    RuleChangeAuditComponent,
  ],
  template: `
    <section class="card">
      <div class="toolbar">
        <div>
          <h2>Rules Studio</h2>
          <p>Preview deterministic score changes before activating an immutable rule version.</p>
        </div>
        <button type="button" (click)="startNewRule()">New rule family</button>
      </div>

      @if (message()) {
        <p [class.error]="state() === 'error'" aria-live="polite">{{ message() }}</p>
      }

      <sportos-rule-version-list
        [rules]="rules()"
        (editRequested)="editRule($event)" />

      <sportos-rule-proposal-editor
        [proposal]="proposal"
        [loading]="state() === 'loading'"
        (proposalChange)="proposal = $event"
        (previewRequested)="preview()" />

      <sportos-rule-impact-preview
        [result]="previewResult()"
        [reason]="reason"
        [loading]="state() === 'loading'"
        (reasonChange)="reason = $event"
        (activateRequested)="activate()" />

      <sportos-rule-change-status
        [change]="activeChange()"
        (cancelRequested)="cancelActiveChange()"
        (retryRequested)="retryActiveChange()" />

      <sportos-rule-change-audit [changes]="changes()" />
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

  proposal: RuleProposal = newRuleProposal();
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
    this.proposal = newRuleProposal();
    this.previewResult.set(null);
    this.reason = '';
    this.message.set('Creating a new rule family.');
  }

  editRule(rule: RuleVersion): void {
    this.proposal = proposalFromRule(rule);
    this.previewResult.set(null);
    this.reason = '';
    this.message.set(`Preparing a new version of ${rule.code}. Choose a cutover after ${formatDate(rule.validFrom)}.`);
  }

  preview(): void {
    this.state.set('loading');
    this.message.set('Calculating a read-only preview…');
    this.previewResult.set(null);
    this.api.previewRule(cleanRuleProposal(this.proposal)).subscribe({
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
        this.message.set(updated.status === 'cancelled'
          ? 'Queued rule change cancelled.'
          : 'Cancellation requested at the next safe boundary.');
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

  private schedulePoll(): void {
    this.stopPolling();
    const change = this.activeChange();
    if (!change || isTerminalRuleChange(change) || this.pollCount >= this.maximumPolls) {
      if (this.pollCount >= this.maximumPolls && change && !isTerminalRuleChange(change)) {
        this.message.set('Automatic monitoring stopped after 120 checks. Refresh Rules Studio to inspect the durable job state.');
      }
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.pollCount += 1;
      this.api.ruleChange(change.id).subscribe({
        next: (updated) => {
          this.activeChange.set(updated);
          if (isTerminalRuleChange(updated)) {
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

  private fail(error: unknown): void {
    this.state.set('error');
    this.message.set(describeRuleRequestError(error));
  }
}
