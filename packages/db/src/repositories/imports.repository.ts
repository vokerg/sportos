import { sql, type Kysely } from 'kysely';
import type { Database, ImportBatch, Json, NewSourceRecord, SourceRecord } from '../schema.js';

export interface ImportFailureDetails {
  phase: string;
  error: unknown;
  attemptedCounts?: {
    rowCount?: number;
    normalizedCount?: number;
    warningCount?: number;
  };
}

export interface NormalizedSourceRecordLink {
  sourceRecordId: string;
  entityType: 'daily_metric' | 'performance_event' | 'activity';
  entityId: string;
}

export class ImportsRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async createBatch(input: {
    source: string;
    sourceKind: 'xlsx' | 'google_sheets' | 'strava' | 'garmin' | 'fit' | 'manual';
    filename?: string;
    originalSha256?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ImportBatch> {
    return this.db
      .insertInto('import_batches')
      .values({
        source: input.source,
        source_kind: input.sourceKind,
        filename: input.filename ?? null,
        original_sha256: input.originalSha256 ?? null,
        metadata: input.metadata ?? {},
        status: 'started',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async insertSourceRecords(records: NewSourceRecord[]): Promise<SourceRecord[]> {
    if (records.length === 0) return [];
    const inserted: SourceRecord[] = [];
    const chunkSize = 500;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      inserted.push(
        ...(await this.db
          .insertInto('source_records')
          .values(chunk)
          .onConflict((oc) =>
            oc.columns(['import_batch_id', 'source_record_key', 'row_hash']).doUpdateSet({
              raw_json: sql`excluded.raw_json`,
              status: 'raw',
              errors: sql`excluded.errors`,
              warnings: sql`excluded.warnings`,
            }),
          )
          .returningAll()
          .execute()),
      );
    }
    return inserted;
  }

  async updateBatchCounts(
    batchId: string,
    counts: Partial<Pick<ImportBatch, 'row_count' | 'normalized_count' | 'error_count' | 'warning_count' | 'status'>>,
  ): Promise<void> {
    const patch: Record<string, unknown> = { ...counts };
    if (counts.status && ['normalized', 'scored', 'failed'].includes(String(counts.status))) {
      patch.completed_at = new Date();
    }
    await this.db.updateTable('import_batches').set(patch).where('id', '=', batchId).execute();
  }

  async markBatchFailed(batchId: string, details: ImportFailureDetails): Promise<void> {
    const batch = await this.db
      .selectFrom('import_batches')
      .select(['metadata', 'error_count'])
      .where('id', '=', batchId)
      .executeTakeFirst();

    const previousMetadata = jsonObject(batch?.metadata);
    const errorName = details.error instanceof Error ? details.error.name : 'ImportError';
    const errorMessage = details.error instanceof Error ? details.error.message : String(details.error);
    const attemptedCounts = compactCounts(details.attemptedCounts);
    const metadata: Json = {
      ...previousMetadata,
      failure: {
        phase: details.phase,
        name: errorName.slice(0, 120),
        message: errorMessage.slice(0, 500),
        recordedAt: new Date().toISOString(),
        attemptedCounts,
      },
    };

    await this.db
      .updateTable('import_batches')
      .set({
        status: 'failed',
        error_count: Math.max(1, (batch?.error_count ?? 0) + 1),
        completed_at: new Date(),
        metadata,
      })
      .where('id', '=', batchId)
      .execute();
  }

  async markRecordsNormalized(links: NormalizedSourceRecordLink[]): Promise<void> {
    for (const link of links) {
      await this.db
        .updateTable('source_records')
        .set({
          status: 'normalized',
          normalized_entity_type: link.entityType,
          normalized_entity_id: link.entityId,
        })
        .where('id', '=', link.sourceRecordId)
        .execute();
    }
  }

  async markRecordNormalized(sourceRecordId: string, entityType: string, entityId: string): Promise<void> {
    await this.db
      .updateTable('source_records')
      .set({ status: 'normalized', normalized_entity_type: entityType, normalized_entity_id: entityId })
      .where('id', '=', sourceRecordId)
      .execute();
  }
}

function jsonObject(value: Json | undefined): Record<string, Json> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value;
}

function compactCounts(counts: ImportFailureDetails['attemptedCounts']): Record<string, Json> {
  if (!counts) return {};
  const result: Record<string, Json> = {};
  if (counts.rowCount !== undefined) result.rowCount = counts.rowCount;
  if (counts.normalizedCount !== undefined) result.normalizedCount = counts.normalizedCount;
  if (counts.warningCount !== undefined) result.warningCount = counts.warningCount;
  return result;
}
