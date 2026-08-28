import type { DailyScoreBreakdownReadModel, SourceRecordReferenceReadModel } from './repository-contracts.js';

export type DailyScoreBreakdown = DailyScoreBreakdownReadModel;

export class ScoreBreakdownContractError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid daily score breakdown: ${issues.join('; ')}`);
    this.name = 'ScoreBreakdownContractError';
  }
}

export function parseDailyScoreBreakdown(value: DailyScoreBreakdownReadModel): DailyScoreBreakdown {
  const issues: string[] = [];
  if (!isIsoDate(value.date)) issues.push('date must be a real calendar date in YYYY-MM-DD format');
  if (!isIsoTimestamp(value.recomputedAt)) issues.push('recomputedAt must be an ISO timestamp');
  if (value.scoreStatus !== 'imported' && value.scoreStatus !== 'calculated') {
    issues.push('scoreStatus must be imported or calculated');
  }

  const ledgerSum = value.ledger.reduce((sum, entry) => sum + entry.points, 0);
  if (ledgerSum !== value.score.ledgerTotal) issues.push('ledgerTotal must equal the sum of ledger entry points');
  if (value.score.ledgerTotal !== value.score.appTotal) issues.push('appTotal must equal ledgerTotal');
  if (value.score.baseTotal + value.score.bonusTotal !== value.score.appTotal) {
    issues.push('baseTotal plus bonusTotal must equal appTotal');
  }

  const expectedDelta = value.score.excelTotal === null ? null : value.score.appTotal - value.score.excelTotal;
  if (expectedDelta === null ? value.score.delta !== null : value.score.delta === null || Math.abs(value.score.delta - expectedDelta) > 1e-9) {
    issues.push('delta must be null without an Excel total, otherwise appTotal minus excelTotal');
  }

  validateSourceRecord(value.sourceRecord, 'sourceRecord', issues);
  value.ledger.forEach((entry, index) => {
    if (!isIsoTimestamp(entry.createdAt)) issues.push(`ledger[${index}].createdAt must be an ISO timestamp`);
    if (entry.rule) {
      if (!isIsoDate(entry.rule.validFrom)) issues.push(`ledger[${index}].rule.validFrom must be an ISO date`);
      if (entry.rule.validTo !== null && !isIsoDate(entry.rule.validTo)) {
        issues.push(`ledger[${index}].rule.validTo must be null or an ISO date`);
      }
      if (!isIsoTimestamp(entry.rule.createdAt)) issues.push(`ledger[${index}].rule.createdAt must be an ISO timestamp`);
    }
    if (entry.activity) {
      if (!isIsoDate(entry.activity.activityDate)) issues.push(`ledger[${index}].activity.activityDate must be an ISO date`);
      if (entry.activity.startTime !== null && !isIsoTimestamp(entry.activity.startTime)) {
        issues.push(`ledger[${index}].activity.startTime must be null or an ISO timestamp`);
      }
      validateSourceRecord(entry.activity.sourceRecord, `ledger[${index}].activity.sourceRecord`, issues);
    }
  });

  if (issues.length > 0) throw new ScoreBreakdownContractError(issues);
  return value;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateSourceRecord(
  value: SourceRecordReferenceReadModel | null,
  path: string,
  issues: string[],
): void {
  if (value === null) return;
  if (!isIsoTimestamp(value.batch.startedAt)) issues.push(`${path}.batch.startedAt must be an ISO timestamp`);
  if (value.batch.completedAt !== null && !isIsoTimestamp(value.batch.completedAt)) {
    issues.push(`${path}.batch.completedAt must be null or an ISO timestamp`);
  }
}

function isIsoTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}
