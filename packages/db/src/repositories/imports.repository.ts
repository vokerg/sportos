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

export interface ImportDiagnosticInput {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  phase: string;
  sheetName?: string | null;
  rowIndex?: number | null;
  sourceRecordId?: string | null;
}

export interface ImportDiagnosticReadModel {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  phase: string;
  sheetName: string | null;
  rowIndex: number | null;
  sourceRecordId: string | null;
  recordedAt: string | null;
}

export interface ImportBatchTransitionReadModel {
  status: ImportBatch['status'];
  phase: string;
  recordedAt: string;
}

export interface ImportBatchFailureReadModel {
  phase: string;
  name: string;
  message: string;
  recordedAt: string;
}

export interface ImportBatchHistoryItemReadModel {
  id: string;
  source: string;
  sourceKind: ImportBatch['source_kind'];
  filename: string | null;
  status: ImportBatch['status'];
  rowCount: number;
  normalizedCount: number;
  warningCount: number;
  errorCount: number;
  startedAt: string;
  completedAt: string | null;
  affectedDates: string[];
  failure: ImportBatchFailureReadModel | null;
}

export interface ImportBatchHistoryPageReadModel {
  items: ImportBatchHistoryItemReadModel[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportBatchDetailReadModel {
  batch: ImportBatchHistoryItemReadModel;
  transitions: ImportBatchTransitionReadModel[];
  diagnostics: ImportDiagnosticReadModel[];
  diagnosticTotal: number;
  diagnosticLimit: number;
  diagnosticOffset: number;
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
    metadata?: Json;
  }): Promise<ImportBatch> {
    const recordedAt = new Date().toISOString();
    return this.db
      .insertInto('import_batches')
      .values({
        source: input.source,
        source_kind: input.sourceKind,
        filename: input.filename ?? null,
        original_sha256: input.originalSha256 ?? null,
        metadata: {
          ...jsonObject(input.metadata),
          affectedDates: [],
          diagnostics: [],
          transitions: [{ status: 'started', phase: 'batch-created', recordedAt }],
        },
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
    phase = counts.status ? `batch-${counts.status}` : 'counts-updated',
  ): Promise<void> {
    const batch = await this.db
      .selectFrom('import_batches')
      .select(['metadata', 'status'])
      .where('id', '=', batchId)
      .executeTakeFirst();
    const patch: Record<string, unknown> = { ...counts };
    if (counts.status && batch?.status !== counts.status) {
      patch.metadata = appendTransition(batch?.metadata, counts.status, phase);
    }
    if (counts.status && ['normalized', 'scored', 'failed'].includes(String(counts.status))) {
      patch.completed_at = new Date();
    }
    await this.db.updateTable('import_batches').set(patch).where('id', '=', batchId).execute();
  }

  async setAffectedDates(batchId: string, dates: string[]): Promise<void> {
    const batch = await this.db
      .selectFrom('import_batches')
      .select('metadata')
      .where('id', '=', batchId)
      .executeTakeFirst();
    if (!batch) return;
    const metadata = jsonObject(batch.metadata);
    const existing = jsonStringArray(metadata.affectedDates);
    const affectedDates = [...new Set([...existing, ...dates.filter(isIsoDateString)])].sort();
    await this.db
      .updateTable('import_batches')
      .set({ metadata: { ...metadata, affectedDates } })
      .where('id', '=', batchId)
      .execute();
  }

  async recordDiagnostics(batchId: string, diagnostics: ImportDiagnosticInput[]): Promise<void> {
    if (diagnostics.length === 0) return;
    const normalized = diagnostics.map(normalizeDiagnostic);
    const batch = await this.db
      .selectFrom('import_batches')
      .select('metadata')
      .where('id', '=', batchId)
      .executeTakeFirst();
    if (!batch) return;

    const metadata = jsonObject(batch.metadata);
    const persistedDiagnostics = [...jsonArray(metadata.diagnostics), ...normalized.map(diagnosticToJson)];
    await this.db
      .updateTable('import_batches')
      .set({ metadata: { ...metadata, diagnostics: persistedDiagnostics } })
      .where('id', '=', batchId)
      .execute();

    for (const diagnostic of normalized) {
      const record = diagnostic.sourceRecordId
        ? await this.db
            .selectFrom('source_records')
            .select(['id', 'warnings', 'errors'])
            .where('id', '=', diagnostic.sourceRecordId)
            .where('import_batch_id', '=', batchId)
            .executeTakeFirst()
        : diagnostic.sheetName !== null && diagnostic.rowIndex !== null
          ? await this.db
              .selectFrom('source_records')
              .select(['id', 'warnings', 'errors'])
              .where('import_batch_id', '=', batchId)
              .where('sheet_name', '=', diagnostic.sheetName)
              .where('row_index', '=', diagnostic.rowIndex)
              .executeTakeFirst()
          : undefined;
      if (!record) continue;

      if (diagnostic.severity === 'warning') {
        await this.db
          .updateTable('source_records')
          .set({ warnings: [...jsonArray(record.warnings), diagnosticToJson({ ...diagnostic, sourceRecordId: record.id })] })
          .where('id', '=', record.id)
          .execute();
      } else {
        await this.db
          .updateTable('source_records')
          .set({ errors: [...jsonArray(record.errors), diagnosticToJson({ ...diagnostic, sourceRecordId: record.id })] })
          .where('id', '=', record.id)
          .execute();
      }
    }
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
    const recordedAt = new Date().toISOString();
    const failure: Json = {
      phase: details.phase,
      name: errorName.slice(0, 120),
      message: errorMessage.slice(0, 500),
      recordedAt,
      attemptedCounts,
    };
    const diagnostic = diagnosticToJson({
      severity: 'error',
      code: 'IMPORT_FAILED',
      message: errorMessage,
      phase: details.phase,
      sheetName: null,
      rowIndex: null,
      sourceRecordId: null,
      recordedAt,
    });
    const metadata: Json = {
      ...previousMetadata,
      failure,
      diagnostics: [...jsonArray(previousMetadata.diagnostics), diagnostic],
      transitions: [
        ...jsonArray(previousMetadata.transitions),
        { status: 'failed', phase: details.phase, recordedAt },
      ],
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

  async listBatches(limit = 20, offset = 0): Promise<ImportBatchHistoryPageReadModel> {
    const boundedLimit = clampInteger(limit, 1, 100);
    const boundedOffset = clampInteger(offset, 0, 10_000);
    const [rows, totalRow] = await Promise.all([
      this.db
        .selectFrom('import_batches')
        .selectAll()
        .orderBy('started_at', 'desc')
        .orderBy('id', 'desc')
        .limit(boundedLimit)
        .offset(boundedOffset)
        .execute(),
      this.db
        .selectFrom('import_batches')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow(),
    ]);

    return {
      items: rows.map(toHistoryItem),
      total: Number(totalRow.count),
      limit: boundedLimit,
      offset: boundedOffset,
    };
  }

  async getBatchDetail(
    batchId: string,
    diagnosticLimit = 100,
    diagnosticOffset = 0,
  ): Promise<ImportBatchDetailReadModel | null> {
    const batch = await this.db
      .selectFrom('import_batches')
      .selectAll()
      .where('id', '=', batchId)
      .executeTakeFirst();
    if (!batch) return null;

    const sourceRecords = await this.db
      .selectFrom('source_records')
      .select(['id', 'sheet_name', 'row_index', 'warnings', 'errors'])
      .where('import_batch_id', '=', batchId)
      .orderBy('sheet_name', 'asc')
      .orderBy('row_index', 'asc')
      .execute();
    const metadata = jsonObject(batch.metadata);
    const diagnostics = deduplicateDiagnostics([
      ...diagnosticsFromJson(metadata.diagnostics),
      ...sourceRecords.flatMap((record) => [
        ...diagnosticsFromJson(record.warnings, {
          severity: 'warning',
          sourceRecordId: record.id,
          sheetName: record.sheet_name,
          rowIndex: record.row_index,
        }),
        ...diagnosticsFromJson(record.errors, {
          severity: 'error',
          sourceRecordId: record.id,
          sheetName: record.sheet_name,
          rowIndex: record.row_index,
        }),
      ]),
    ]);
    const boundedLimit = clampInteger(diagnosticLimit, 1, 250);
    const boundedOffset = clampInteger(diagnosticOffset, 0, 50_000);

    return {
      batch: toHistoryItem(batch),
      transitions: transitionsFromJson(metadata.transitions),
      diagnostics: diagnostics.slice(boundedOffset, boundedOffset + boundedLimit),
      diagnosticTotal: diagnostics.length,
      diagnosticLimit: boundedLimit,
      diagnosticOffset: boundedOffset,
    };
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

function toHistoryItem(batch: ImportBatch): ImportBatchHistoryItemReadModel {
  const metadata = jsonObject(batch.metadata);
  return {
    id: batch.id,
    source: batch.source,
    sourceKind: batch.source_kind,
    filename: safeFilename(batch.filename),
    status: batch.status,
    rowCount: batch.row_count,
    normalizedCount: batch.normalized_count,
    warningCount: batch.warning_count,
    errorCount: batch.error_count,
    startedAt: batch.started_at.toISOString(),
    completedAt: batch.completed_at?.toISOString() ?? null,
    affectedDates: jsonStringArray(metadata.affectedDates).filter(isIsoDateString).sort(),
    failure: failureFromJson(metadata.failure),
  };
}

function appendTransition(metadataValue: Json | undefined, status: ImportBatch['status'], phase: string): Json {
  const metadata = jsonObject(metadataValue);
  return {
    ...metadata,
    transitions: [
      ...jsonArray(metadata.transitions),
      { status, phase: phase.slice(0, 120), recordedAt: new Date().toISOString() },
    ],
  };
}

function normalizeDiagnostic(input: ImportDiagnosticInput): ImportDiagnosticReadModel {
  return {
    severity: input.severity,
    code: input.code.trim().slice(0, 120) || 'IMPORT_DIAGNOSTIC',
    message: input.message.trim().slice(0, 1000),
    phase: input.phase.trim().slice(0, 120) || 'unknown',
    sheetName: input.sheetName?.trim().slice(0, 255) || null,
    rowIndex: Number.isInteger(input.rowIndex) && Number(input.rowIndex) > 0 ? Number(input.rowIndex) : null,
    sourceRecordId: input.sourceRecordId ?? null,
    recordedAt: new Date().toISOString(),
  };
}

function diagnosticToJson(diagnostic: ImportDiagnosticReadModel): Json {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    phase: diagnostic.phase,
    sheetName: diagnostic.sheetName,
    rowIndex: diagnostic.rowIndex,
    sourceRecordId: diagnostic.sourceRecordId,
    recordedAt: diagnostic.recordedAt,
  };
}

function diagnosticsFromJson(
  value: Json | undefined,
  defaults: Partial<ImportDiagnosticReadModel> = {},
): ImportDiagnosticReadModel[] {
  return jsonArray(value).flatMap((entry) => {
    if (typeof entry === 'string') {
      return [{
        severity: defaults.severity ?? 'warning',
        code: defaults.code ?? 'IMPORT_DIAGNOSTIC',
        message: entry.slice(0, 1000),
        phase: defaults.phase ?? 'parse',
        sheetName: defaults.sheetName ?? null,
        rowIndex: defaults.rowIndex ?? null,
        sourceRecordId: defaults.sourceRecordId ?? null,
        recordedAt: defaults.recordedAt ?? null,
      }];
    }
    const object = jsonObject(entry);
    const message = jsonString(object.message);
    if (!message) return [];
    const severity = object.severity === 'error' || object.severity === 'warning'
      ? object.severity
      : defaults.severity ?? 'warning';
    return [{
      severity,
      code: jsonString(object.code) ?? defaults.code ?? 'IMPORT_DIAGNOSTIC',
      message,
      phase: jsonString(object.phase) ?? defaults.phase ?? 'parse',
      sheetName: jsonString(object.sheetName) ?? defaults.sheetName ?? null,
      rowIndex: jsonPositiveInteger(object.rowIndex) ?? defaults.rowIndex ?? null,
      sourceRecordId: jsonString(object.sourceRecordId) ?? defaults.sourceRecordId ?? null,
      recordedAt: jsonString(object.recordedAt) ?? defaults.recordedAt ?? null,
    }];
  });
}

function transitionsFromJson(value: Json | undefined): ImportBatchTransitionReadModel[] {
  return jsonArray(value).flatMap((entry) => {
    const object = jsonObject(entry);
    const status = object.status;
    const phase = jsonString(object.phase);
    const recordedAt = jsonString(object.recordedAt);
    if (!isImportStatus(status) || !phase || !recordedAt) return [];
    return [{ status, phase, recordedAt }];
  });
}

function failureFromJson(value: Json | undefined): ImportBatchFailureReadModel | null {
  const object = jsonObject(value);
  const phase = jsonString(object.phase);
  const name = jsonString(object.name);
  const message = jsonString(object.message);
  const recordedAt = jsonString(object.recordedAt);
  return phase && name && message && recordedAt ? { phase, name, message, recordedAt } : null;
}

function deduplicateDiagnostics(diagnostics: ImportDiagnosticReadModel[]): ImportDiagnosticReadModel[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.message,
      diagnostic.sheetName ?? '',
      diagnostic.rowIndex ?? '',
      diagnostic.sourceRecordId ?? '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeFilename(filename: string | null): string | null {
  if (!filename) return null;
  const basename = filename.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)?.trim();
  return basename ? basename.slice(0, 255) : null;
}

function isImportStatus(value: Json | undefined): value is ImportBatch['status'] {
  return value === 'started' || value === 'parsed' || value === 'normalized' || value === 'scored' || value === 'failed';
}

function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function jsonObject(value: Json | undefined): Record<string, Json> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return {};
  return value;
}

function jsonArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function jsonStringArray(value: Json | undefined): string[] {
  return jsonArray(value).filter((entry): entry is string => typeof entry === 'string');
}

function jsonString(value: Json | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function jsonPositiveInteger(value: Json | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function compactCounts(counts: ImportFailureDetails['attemptedCounts']): Record<string, Json> {
  if (!counts) return {};
  const result: Record<string, Json> = {};
  if (counts.rowCount !== undefined) result.rowCount = counts.rowCount;
  if (counts.normalizedCount !== undefined) result.normalizedCount = counts.normalizedCount;
  if (counts.warningCount !== undefined) result.warningCount = counts.warningCount;
  return result;
}
