import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  previewRuleChange,
  validateRuleProposal,
  type RuleChangePreview,
  type RuleProposal,
} from '@sportos/domain';
import { RuleChangesRepository, type RuleChangeReadModel, type RuleVersionReadModel } from '@sportos/db';
import { DbProvider } from '../db.provider.js';

export interface RulePreviewResponse {
  proposal: RuleProposal;
  preview: RuleChangePreview;
  previewFingerprint: string;
}

export interface ActivateRuleChangeRequest {
  proposal: RuleProposal;
  previewFingerprint: string;
  reason: string;
  initiatedBy?: string;
}

export class StaleRulePreviewError extends Error {
  constructor() {
    super('The preview is stale because rule configuration or daily facts changed. Preview again before activation.');
    this.name = 'StaleRulePreviewError';
  }
}

@Injectable()
export class RulesService {
  private readonly rules: RuleChangesRepository;

  constructor(private readonly database: DbProvider) {
    this.rules = new RuleChangesRepository(database.db);
  }

  listRules(): Promise<RuleVersionReadModel[]> {
    return this.rules.listRuleVersions();
  }

  listChanges(limit = 50): Promise<RuleChangeReadModel[]> {
    return this.rules.listChanges(limit);
  }

  getChange(changeId: string): Promise<RuleChangeReadModel | null> {
    return this.rules.getById(changeId);
  }

  async preview(input: RuleProposal): Promise<RulePreviewResponse> {
    const proposal = validateRuleProposal(input);
    const latestMetricDate = await this.rules.latestMetricDate();
    const availableTo = latestMetricDate && latestMetricDate >= proposal.validFrom
      ? latestMetricDate
      : proposal.validFrom;
    const affectedTo = proposal.validTo && proposal.validTo < availableTo
      ? proposal.validTo
      : availableTo;
    const [days, currentRules] = await Promise.all([
      this.rules.listPreviewDays(proposal.validFrom, affectedTo),
      this.rules.listEnabledRules(),
    ]);
    const preview = {
      ...previewRuleChange(days, currentRules, proposal),
      affectedFrom: proposal.validFrom,
      affectedTo,
    };
    const previewFingerprint = fingerprint({
      proposal,
      preview,
      currentRuleVersions: currentRules.map((rule) => ({ id: rule.id, code: rule.code, validFrom: rule.validFrom, validTo: rule.validTo })),
      dailyVersions: days.map((day) => ({ metricDate: day.facts.metricDate, recomputedAt: day.recomputedAt, currentTotalPoints: day.currentTotalPoints })),
    });
    return { proposal, preview, previewFingerprint };
  }

  async activate(input: ActivateRuleChangeRequest): Promise<RuleChangeReadModel> {
    const reason = String(input.reason ?? '').trim();
    if (!reason || reason.length > 1000) throw new InvalidRuleChangeReasonError();
    const current = await this.preview(input.proposal);
    if (!safeEqual(current.previewFingerprint, String(input.previewFingerprint ?? ''))) {
      throw new StaleRulePreviewError();
    }
    return this.rules.enqueueChange({
      proposal: current.proposal,
      preview: current.preview,
      previewFingerprint: current.previewFingerprint,
      initiatedBy: String(input.initiatedBy ?? 'local-user'),
      reason,
    });
  }

  retry(changeId: string): Promise<RuleChangeReadModel | null> {
    return this.rules.retry(changeId);
  }

  cancel(changeId: string): Promise<RuleChangeReadModel | null> {
    return this.rules.requestCancellation(changeId);
  }
}

export class InvalidRuleChangeReasonError extends Error {
  constructor() {
    super('A concise audit reason is required and must be at most 1000 characters.');
    this.name = 'InvalidRuleChangeReasonError';
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  return left.length === right.length && left === right;
}
