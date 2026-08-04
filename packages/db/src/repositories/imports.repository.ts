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
      const chunk = records.slice(i, i + chunkSize).map((record) => ({
        ...record,
        raw_json: jsonb(record.raw_json ?? null),
        errors: jsonb(record.errors ?? []),
        warnings: jsonb(record.warnings ?? []),
      }));
      inserted.push(
        ...(await this.db
          .insertInto('source_records')
          .values(chunk)
          .onConflict((oc) =>
            oc.columns(['owner_id', 'import_batch_id', 'source_record_key', 'row_hash']).doUpdateSet({
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
          .set({
            warnings: jsonb([
              ...jsonArray(record.warnings),
              diagnosticToJson({ ...diagnostic, sourceRecordId: record.id }),
            ]),
          })
          .where('id', '=', record.id)
          .execute();
      } else {
        await this.db
          .updateTable('source_records')
          .set({
            errors: jsonb([
              ...jsonArray(record.errors),
              diagnosticToJson({ ...diagnostic, sourceRecordId: record.id }),
            ]),
          })
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
    const rawErrorMessage = details.error instanceof Error ? details.error.message : String(details.error);
    const errorMessage = redactSensitiveText(rawErrorMessage);
    const attemptedCounts = compactCounts(details.attemptedCounts);
    const recordedAt = new Date().toISOString();
    const failure: Json = {
      phase: details.phase,
      name: sanitizeErrorName(errorName),
      message: errorMessage,
      recordedAt,
      ...(attemptedCounts ? { attemptedCounts } : {}),
    };
    const diagnostics = [
      ...jsonArray(previousMetadata.diagnostics),
      diagnosticToJson({
        severity: 'error',
        code: 'IMPORT_FAILED',
        message: errorMessage,
        phase: details.phase,
        sheetName: null,
        rowIndex: null,
        sourceRecordId: null,
        recordedAt,
      }),
    ];
    const transitions = appendTransition(previousMetadata, 'failed', details.phase).transitions;
    const previousErrorCount = Number(batch?.error_count ?? 0);

    await this.db
      .updateTable('import_batches')
      .set({
        status: 'failed',
        completed_at: new Date(),
        row_count: details.attemptedCounts?.rowCount ?? undefined,
        normalized_count: details.attemptedCounts?.normalizedCount ?? undefined,
        warning_count: details.attemptedCounts?.warningCount ?? undefined,
        error_count: Math.max(previousErrorCount, 1),
        metadata: {
          ...previousMetadata,
          failure,
          diagnostics,
          transitions,
        },
      })
      .where('id', '=', batchId)
      .execute();
  }

  async linkNormalizedRecords(links: NormalizedSourceRecordLink[]): Promise<void> {
    for (const link of links) {
      await this.db
        .updateTable('source_records')
        .set({
          normalized_entity_type: link.entityType,
          normalized_entity_id: link.entityId,
          status: 'normalized',
        })
        .where('id', '=', link.sourceRecordId)
        .execute();
    }
  }

  async markRecordsNormalized(links: NormalizedSourceRecordLink[]): Promise<void> {
    await this.linkNormalizedRecords(links);
  }

  async listBatches(limit = 20, offset = 0): Promise<ImportBatchHistoryPageReadModel> {
    const boundedLimit = clampInteger(limit, 1, 100);
    const boundedOffset = clampInteger(offset, 0, 10_000);
    const [rows, countRow] = await Promise.all([
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
      items: rows.map(mapBatchHistoryItem),
      total: Number(countRow.count),
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

    const boundedLimit = clampInteger(diagnosticLimit, 1, 250);
    const boundedOffset = clampInteger(diagnosticOffset, 0, 50_000);
    const allDiagnostics = parseDiagnostics(batch.metadata);
    return {
      batch: mapBatchHistoryItem(batch),
      transitions: parseTransitions(batch.metadata, batch.status, timestampToIso(batch.started_at)),
      diagnostics: allDiagnostics.slice(boundedOffset, boundedOffset + boundedLimit),
      diagnosticTotal: allDiagnostics.length,
      diagnosticLimit: boundedLimit,
      diagnosticOffset: boundedOffset,
    };
  }
}

function mapBatchHistoryItem(row: ImportBatch): ImportBatchHistoryItemReadModel {
  const metadata = jsonObject(row.metadata);
  return {
    id: row.id,
    source: row.source,
    sourceKind: row.source_kind,
    filename: safeFilename(row.filename),
    status: row.status,
    rowCount: Number(row.row_count),
    normalizedCount: Number(row.normalized_count),
    warningCount: Number(row.warning_count),
    errorCount: Number(row.error_count),
    startedAt: timestampToIso(row.started_at),
    completedAt: row.completed_at ? timestampToIso(row.completed_at) : null,
    affectedDates: jsonStringArray(metadata.affectedDates).sort(),
    failure: parseFailure(metadata.failure),
  };
}

function parseTransitions(
  metadataValue: Json,
  fallbackStatus: ImportBatch['status'],
  fallbackRecordedAt: string,
): ImportBatchTransitionReadModel[] {
  const metadata = jsonObject(metadataValue);
  const transitions = jsonArray(metadata.transitions)
    .map((value) => {
      const item = jsonObject(value);
      const status = isImportStatus(item.status) ? item.status : null;
      const phase = typeof item.phase === 'string' ? item.phase : null;
      const recordedAt = typeof item.recordedAt === 'string' ? item.recordedAt : null;
      return status && phase && recordedAt ? { status, phase, recordedAt } : null;
    })
    .filter((value): value is ImportBatchTransitionReadModel => value !== null);
  return transitions.length > 0
    ? transitions
    : [{ status: fallbackStatus, phase: 'legacy-import', recordedAt: fallbackRecordedAt }];
}

function parseDiagnostics(value: Json): ImportDiagnosticReadModel[] {
  return jsonArray(jsonObject(value).diagnostics)
    .map((item) => {
      const diagnostic = jsonObject(item);
      if (diagnostic.severity !== 'warning' && diagnostic.severity !== 'error') return null;
      if (typeof diagnostic.code !== 'string' || typeof diagnostic.message !== 'string') return null;
      if (typeof diagnostic.phase !== 'string') return null;
      return {
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: redactSensitiveText(diagnostic.message),
        phase: diagnostic.phase,
        sheetName: typeof diagnostic.sheetName === 'string' ? diagnostic.sheetName : null,
        rowIndex: typeof diagnostic.rowIndex === 'number' ? diagnostic.rowIndex : null,
        sourceRecordId: typeof diagnostic.sourceRecordId === 'string' ? diagnostic.sourceRecordId : null,
        recordedAt: typeof diagnostic.recordedAt === 'string' ? diagnostic.recordedAt : null,
      } satisfies ImportDiagnosticReadModel;
    })
    .filter((item): item is ImportDiagnosticReadModel => item !== null);
}

function parseFailure(value: Json | undefined): ImportBatchFailureReadModel | null {
  const failure = jsonObject(value);
  if (
    typeof failure.phase !== 'string'
    || typeof failure.name !== 'string'
    || typeof failure.message !== 'string'
    || typeof failure.recordedAt !== 'string'
  ) return null;
  return {
    phase: failure.phase,
    name: failure.name,
    message: redactSensitiveText(failure.message),
    recordedAt: failure.recordedAt,
  };
}

function appendTransition(metadataValue: Json | undefined, status: ImportBatch['status'], phase: string): Record<string, Json> {
  const metadata = jsonObject(metadataValue);
  const transitions = [
    ...jsonArray(metadata.transitions),
    { status, phase: safePhase(phase), recordedAt: new Date().toISOString() },
  ] as Json[];
  return { ...metadata, transitions };
}

function normalizeDiagnostic(value: ImportDiagnosticInput): ImportDiagnosticReadModel {
  return {
    severity: value.severity,
    code: sanitizeCode(value.code, value.severity === 'warning' ? 'IMPORT_WARNING' : 'IMPORT_ERROR'),
    message: redactSensitiveText(value.message),
    phase: safePhase(value.phase),
    sheetName: safeSheetName(value.sheetName),
    rowIndex: Number.isInteger(value.rowIndex) && Number(value.rowIndex) >= 0 ? Number(value.rowIndex) : null,
    sourceRecordId: typeof value.sourceRecordId === 'string' ? value.sourceRecordId : null,
    recordedAt: new Date().toISOString(),
  };
}

function diagnosticToJson(value: ImportDiagnosticReadModel): Json {
  return {
    severity: value.severity,
    code: value.code,
    message: value.message,
    phase: value.phase,
    sheetName: value.sheetName,
    rowIndex: value.rowIndex,
    sourceRecordId: value.sourceRecordId,
    recordedAt: value.recordedAt,
  };
}

function compactCounts(value: ImportFailureDetails['attemptedCounts']): Json | undefined {
  if (!value) return undefined;
  const counts: Record<string, number> = {};
  if (Number.isInteger(value.rowCount)) counts.rowCount = Number(value.rowCount);
  if (Number.isInteger(value.normalizedCount)) counts.normalizedCount = Number(value.normalizedCount);
  if (Number.isInteger(value.warningCount)) counts.warningCount = Number(value.warningCount);
  return Object.keys(counts).length > 0 ? counts : undefined;
}

function jsonb(value: Json) {
  return sql<Json>`${JSON.stringify(value)}::jsonb`;
}

function jsonObject(value: Json | undefined): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function jsonArray(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function jsonStringArray(value: Json | undefined): string[] {
  return jsonArray(value).filter((item): item is string => typeof item === 'string');
}

function safeFilename(value: string | null): string | null {
  if (!value) return null;
  return value.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)?.slice(0, 255) ?? null;
}

function safeSheetName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/[\r\n\t]/g, ' ').trim().slice(0, 255) || null;
}

function safePhase(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 100) || 'unknown';
}

function sanitizeErrorName(value: string): string {
  return value.replace(/[^A-Za-z0-9_$.-]+/g, '_').slice(0, 100) || 'ImportError';
}

function sanitizeCode(value: string, fallback: string): string {
  return value.replace(/[^A-Z0-9_-]+/gi, '_').toUpperCase().slice(0, 100) || fallback;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(["'`])(?:[A-Za-z]:[\\/]|\/)[^"'`\r\n]+\1/g, '$1[redacted local path]$1')
    .replace(/\b[A-Za-z]:[\\/][^\s,;]+/g, '[redacted local path]')
    .replace(/(^|\s)\/(?:[^/\s]+\/)*[^/\s,;]+/g, '$1[redacted local path]')
    .slice(0, 500);
}

function isImportStatus(value: Json | undefined): value is ImportBatch['status'] {
  return typeof value === 'string' && ['started', 'parsed', 'normalized', 'scored', 'failed'].includes(value);
}

function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function timestampToIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
  }
  return String(value);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
