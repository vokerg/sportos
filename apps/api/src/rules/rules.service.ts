import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  LEGACY_ACCOUNT_ID,
  previewRuleChange,
  validateRuleProposal,
  RuleChangesRepository,
  type Database,
  type Kysely,
  type RuleChangePreview,
  type RuleChangeReadModel,
  type RuleProposal,
  type RuleVersionReadModel,
} from '@sportos/db';
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

export class RulePreviewLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Rule preview is limited to ${limit} persisted dates.`);
    this.name = 'RulePreviewLimitError';
  }
}

@Injectable()
export class RulesService {
  private readonly previewDateLimit = 5000;

  constructor(private readonly database: DbProvider) {}

  listRules(accountId = LEGACY_ACCOUNT_ID): Promise<RuleVersionReadModel[]> {
    return this.database.withAccount(accountId, (db) => new RuleChangesRepository(db).listRuleVersions());
  }

  listChanges(limit = 50, accountId = LEGACY_ACCOUNT_ID): Promise<RuleChangeReadModel[]> {
    return this.database.withAccount(accountId, (db) => new RuleChangesRepository(db).listChanges(limit));
  }

  getChange(changeId: string, accountId = LEGACY_ACCOUNT_ID): Promise<RuleChangeReadModel | null> {
    return this.database.withAccount(accountId, (db) => new RuleChangesRepository(db).getById(changeId));
  }

  preview(input: RuleProposal, accountId = LEGACY_ACCOUNT_ID): Promise<RulePreviewResponse> {
    return this.database.withAccount(accountId, (db) => this.previewUsing(db, input));
  }

  activate(input: ActivateRuleChangeRequest, accountId = LEGACY_ACCOUNT_ID): Promise<RuleChangeReadModel> {
    return this.database.withAccount(accountId, async (db) => {
      const reason = String(input.reason ?? '').trim();
      if (!reason || reason.length > 1000) throw new InvalidRuleChangeReasonError();
      const current = await this.previewUsing(db, input.proposal);
      if (!safeEqual(current.previewFingerprint, String(input.previewFingerprint ?? ''))) {
        throw new StaleRulePreviewError();
      }
      return new RuleChangesRepository(db).enqueueChange({
        proposal: current.proposal,
        preview: current.preview,
        previewFingerprint: current.previewFingerprint,
        initiatedBy: accountId,
        reason,
      });
    });
  }

  retry(changeId: string, accountId = LEGACY_ACCOUNT_ID): Promise<RuleChangeReadModel | null> {
    return this.database.withAccount(accountId, (db) => new RuleChangesRepository(db).retry(changeId));
  }

  cancel(changeId: string, accountId = LEGACY_ACCOUNT_ID): Promise<RuleChangeReadModel | null> {
    return this.database.withAccount(accountId, (db) => new RuleChangesRepository(db).requestCancellation(changeId));
  }

  private async previewUsing(db: Kysely<Database>, input: RuleProposal): Promise<RulePreviewResponse> {
    const rules = new RuleChangesRepository(db);
    const proposal = validateRuleProposal(input);
    const latestMetricDate = await rules.latestMetricDate();
    const availableTo = latestMetricDate && latestMetricDate >= proposal.validFrom ? latestMetricDate : proposal.validFrom;
    const affectedTo = proposal.validTo && proposal.validTo < availableTo ? proposal.validTo : availableTo;
    const [days, currentRules] = await Promise.all([
      rules.listPreviewDays(proposal.validFrom, affectedTo),
      rules.listEnabledRules(),
    ]);
    if (days.length > this.previewDateLimit) throw new RulePreviewLimitError(this.previewDateLimit);
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
