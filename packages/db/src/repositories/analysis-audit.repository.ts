import type { Kysely } from 'kysely';
import type {
  AnalysisDataQualityStatus,
  AnalysisRunGenerator,
  AnalysisRunOutcome,
} from '../analysis-schema.js';
import type { Database, Json } from '../schema.js';

export interface RecordAnalysisRunInput {
  questionHash: string;
  toolName: 'daily_summary' | 'daily_score_breakdown' | null;
  inputSummary: Record<string, unknown>;
  citationKeys: string[];
  generator: AnalysisRunGenerator;
  modelProvider: string | null;
  modelName: string | null;
  outcome: AnalysisRunOutcome;
  dataQualityStatus: AnalysisDataQualityStatus | null;
}

export interface AnalysisRunAudit {
  id: string;
  questionHash: string;
  toolName: RecordAnalysisRunInput['toolName'];
  inputSummary: Json;
  citationKeys: string[];
  generator: AnalysisRunGenerator;
  modelProvider: string | null;
  modelName: string | null;
  outcome: AnalysisRunOutcome;
  dataQualityStatus: AnalysisDataQualityStatus | null;
  createdAt: string;
}

export class AnalysisAuditRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async record(input: RecordAnalysisRunInput): Promise<string> {
    const row = await this.db
      .insertInto('analysis_runs')
      .values({
        question_hash: input.questionHash,
        tool_name: input.toolName,
        input_summary_json: input.inputSummary as Json,
        citation_keys: [...new Set(input.citationKeys)].sort(),
        generator: input.generator,
        model_provider: input.modelProvider,
        model_name: input.modelName,
        outcome: input.outcome,
        data_quality_status: input.dataQualityStatus,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async listRecent(limit = 50): Promise<AnalysisRunAudit[]> {
    const rows = await this.db
      .selectFrom('analysis_runs')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(Math.min(200, Math.max(1, Math.trunc(limit))))
      .execute();
    return rows.map((row) => ({
      id: row.id,
      questionHash: row.question_hash,
      toolName: row.tool_name,
      inputSummary: row.input_summary_json,
      citationKeys: row.citation_keys,
      generator: row.generator,
      modelProvider: row.model_provider,
      modelName: row.model_name,
      outcome: row.outcome,
      dataQualityStatus: row.data_quality_status,
      createdAt: toIsoTimestamp(row.created_at),
    }));
  }
}

function toIsoTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  throw new TypeError('Expected a database timestamp value.');
}
