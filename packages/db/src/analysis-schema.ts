import type { Generated } from 'kysely';
import type { GeneratedTimestamp, Json, OwnerId } from './schema.js';

export type AnalysisRunGenerator = 'none' | 'deterministic_fallback' | 'external_model';
export type AnalysisRunOutcome =
  | 'tool_succeeded'
  | 'answered'
  | 'insufficient_data'
  | 'refused'
  | 'fallback'
  | 'failed';
export type AnalysisDataQualityStatus = 'complete' | 'partial' | 'missing' | 'conflicting';

export interface AnalysisRunsTable {
  id: Generated<string>;
  owner_id: OwnerId;
  question_hash: string;
  tool_name: 'daily_summary' | 'daily_score_breakdown' | null;
  input_summary_json: Json;
  citation_keys: string[];
  generator: AnalysisRunGenerator;
  model_provider: string | null;
  model_name: string | null;
  outcome: AnalysisRunOutcome;
  data_quality_status: AnalysisDataQualityStatus | null;
  created_at: GeneratedTimestamp;
}

declare module './schema.js' {
  interface Database {
    analysis_runs: AnalysisRunsTable;
  }
}
