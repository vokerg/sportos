import type { Kysely } from 'kysely';
import type { Database, ImportBatch, NewSourceRecord, SourceRecord } from '../schema.js';

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
    return this.db.insertInto('source_records').values(records).returningAll().execute();
  }

  async updateBatchCounts(batchId: string, counts: Partial<Pick<ImportBatch, 'row_count' | 'normalized_count' | 'error_count' | 'warning_count' | 'status'>>): Promise<void> {
    const patch: Record<string, unknown> = { ...counts };
    if (counts.status && ['normalized', 'scored', 'failed'].includes(String(counts.status))) {
      patch.completed_at = new Date();
    }
    await this.db
      .updateTable('import_batches')
      .set(patch)
      .where('id', '=', batchId)
      .execute();
  }

  async markRecordNormalized(sourceRecordId: string, entityType: string, entityId: string): Promise<void> {
    await this.db
      .updateTable('source_records')
      .set({ status: 'normalized', normalized_entity_type: entityType, normalized_entity_id: entityId })
      .where('id', '=', sourceRecordId)
      .execute();
  }
}
