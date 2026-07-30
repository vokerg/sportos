import type { Kysely } from 'kysely';
import type { EnabledScoringRule } from '../repository-contracts.js';
import type { Database, ScoringRuleRow } from '../schema.js';

export class ScoringRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listEnabledRules(): Promise<EnabledScoringRule[]> {
    const rows = await this.db.selectFrom('scoring_rules').selectAll().where('enabled', '=', true).execute();
    return rows.map(toEnabledRule);
  }
}

function toEnabledRule(row: ScoringRuleRow): EnabledScoringRule {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    activityType: row.activity_type,
    ruleKind: row.rule_kind,
    metric: row.metric,
    coefficient: optionalNumber(row.coefficient),
    thresholdOperator: row.threshold_operator ?? undefined,
    thresholdValue: optionalNumber(row.threshold_value),
    thresholdUnit: row.threshold_unit ?? undefined,
    points: optionalNumber(row.points),
    validFrom: dateString(row.valid_from),
    validTo: row.valid_to === null ? undefined : dateString(row.valid_to),
    priority: requiredNumber(row.priority, `priority for ${row.code}`),
    enabled: row.enabled,
    description: row.description ?? undefined,
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredNumber(value, 'optional scoring value');
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric ${field}.`);
  return parsed;
}

function dateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const candidate = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  }
  throw new Error('Invalid scoring rule effective date.');
}
