import type { Generated } from 'kysely';
import type { MetricProvider, MetricSourceKind } from '@sportos/domain';
import type { OwnerId, GeneratedTimestamp } from './schema.js';
export interface ActivityMetricProjectionsTable {
  id: Generated<string>; owner_id: OwnerId; activity_id: string; provider: MetricProvider;
  source_ref: string; source_version: string; input_hash: string; parser_version: number;
  state: 'processed' | 'partial' | 'stale'; rich_retained: boolean; compact_only: boolean;
  missing_count: number; rejected_count: number; value_count: number; projected_at: GeneratedTimestamp;
}
export interface ActivityProviderMetricValuesTable {
  owner_id: OwnerId; activity_id: string; provider: MetricProvider; projection_id: string;
  metric_key: string; value: number; unit: string; source_kind: MetricSourceKind; source_field: string;
  source_unit: string; origin: 'recorded' | 'provider_derived' | 'calculated'; precedence: number;
}
export interface ActivityMetricHeadsTable {
  owner_id: OwnerId; activity_id: string; provider: MetricProvider; source_ref: string; source_version: string;
  projection_id: string | null; expected_input_hash: string | null; state: 'unprocessed' | 'processed' | 'partial' | 'failed' | 'stale';
  rich_retained: boolean | null; failure_category: 'retained_read_failed' | 'projection_failed' | null;
  inspected_at: GeneratedTimestamp; updated_at: GeneratedTimestamp;
}
