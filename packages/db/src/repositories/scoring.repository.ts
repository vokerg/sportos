import type { Kysely } from 'kysely';
import type { ScoringRule } from '@sportos/domain';
import type { Database, ScoringRuleRow } from '../schema.js';

export class ScoringRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listEnabledRules(): Promise<ScoringRule[]> {
    const rows = await this.db.selectFrom('scoring_rules').selectAll().where('enabled', '=', true).execute();
    return rows.map(toDomainRule);
  }
}

function toDomainRule(row: ScoringRuleRow): ScoringRule {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    activityType: row.activity_type,
    ruleKind: row.rule_kind,
    metric: row.metric,
    coefficient: row.coefficient ?? undefined,
    thresholdOperator: row.threshold_operator ?? undefined,
    thresholdValue: row.threshold_value ?? undefined,
    thresholdUnit: row.threshold_unit ?? undefined,
    points: row.points ?? undefined,
    validFrom: row.valid_from,
    validTo: row.valid_to ?? undefined,
    priority: row.priority,
    enabled: row.enabled,
    description: row.description ?? undefined,
  };
}
