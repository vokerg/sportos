import { createHash } from 'node:crypto';
import {
  ImportsRepository, ProvidersRepository, WorkerDispatchRepository, withAccountContext,
  type Database, type DispatchedProviderSync, type Json, type Kysely, type NewSourceRecord,
} from '@sportos/db';
import {
  CredentialCipher, ProviderError, canonicalActivityType, stravaActivityFingerprint,
  type ProviderActivity, type ProviderAdapter, type ProviderAuthorization,
} from '@sportos/importers';

export interface ProviderSyncRunnerOptions { workerId: string; leaseSeconds?: number; pollIntervalMs?: number; pageSize?: number; }

export class ProviderSyncRunner {
  private readonly workerId: string;
  private readonly leaseSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly pageSize: number;

  constructor(
    private readonly dispatchDb: Kysely<Database>, private readonly dataDb: Kysely<Database>,
    private readonly adapter: ProviderAdapter, private readonly credentialCipher: CredentialCipher,
    options: ProviderSyncRunnerOptions,
  ) {
    this.workerId = safeWorkerId(options.workerId);
    this.leaseSeconds = clampInteger(options.leaseSeconds ?? 60, 15, 600);
    this.pollIntervalMs = clampInteger(options.pollIntervalMs ?? 1000, 100, 60_000);
    this.pageSize = clampInteger(options.pageSize ?? 200, 1, 200);
  }

  async run(signal: AbortSignal): Promise<void> {
    const dispatch = new WorkerDispatchRepository(this.dispatchDb);
    while (!signal.aborted) {
      await dispatch.recoverStaleProviderSyncs();
      const job = await dispatch.claimProviderSync(this.workerId, this.leaseSeconds);
      if (!job) { await delay(this.pollIntervalMs, signal); continue; }
      await this.process(job).catch(() => undefined);
    }
  }

  async process(job: DispatchedProviderSync): Promise<void> {
    let batchId: string | null = null;
    try {
      let authorization = await this.loadAuthorization(job);
      if (authorization.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000) {
        authorization = await this.adapter.refreshAuthorization(authorization);
        const envelope = this.credentialCipher.encrypt(job.connectionId, job.ownerId, this.adapter.provider, authorization);
        await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).replaceCredential(job.connectionId, envelope, authorization.expiresAt));
      }

      const currentJob = await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).getSyncJob(job.id));
      batchId = currentJob?.batchId ?? await this.createBatch(job);
      const startPage = cursorPage(job.cursor);
      let page = startPage;
      let highWatermark = cursorHighWatermark(job.cursor);
      let rawCount = cursorCount(job.cursor, 'rawCount');
      let activityCount = cursorCount(job.cursor, 'activityCount');
      let performanceCount = cursorCount(job.cursor, 'performanceCount');
      let warningCount = cursorCount(job.cursor, 'warningCount');

      for (; page <= 100_000; page += 1) {
        if (await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).cancellationRequested(job.id, this.workerId))) {
          await this.withOwner(job.ownerId, async (db) => {
            await new ProvidersRepository(db).markCancelled(job.id, this.workerId);
            await new ImportsRepository(db).markBatchFailed(requireBatch(batchId), { phase: 'provider-sync-cancelled', error: new Error('Provider sync was cancelled.'), attemptedCounts: { rowCount: rawCount, normalizedCount: activityCount, warningCount } });
          });
          return;
        }
        await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).heartbeat(job.id, this.workerId, `fetching-page-${page}`, Math.min(90, 10 + page), this.leaseSeconds));

        let fetched;
        try {
          fetched = await this.adapter.fetchActivityPage({ authorization, page, perPage: this.pageSize, after: job.requestedAfter ?? undefined, before: job.requestedBefore ?? undefined });
        } catch (error) {
          if (error instanceof ProviderError && error.code === 'PROVIDER_RATE_LIMITED' && error.retryAt) {
            await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).reschedule(job.id, this.workerId, error.retryAt!, error.code, error.message));
            return;
          }
          throw error;
        }

        if (fetched.activities.length === 0) break;
        for (const activity of fetched.activities) {
          rawCount += 1;
          if (!highWatermark || activity.startDate > highWatermark) highWatermark = activity.startDate;
          const canonicalType = canonicalActivityType(activity);
          const raw = boundedRaw(activity.raw);
          const rawHash = hashJson(raw);
          if (!canonicalType) {
            await this.recordSkipped(job.ownerId, requireBatch(batchId), activity, raw, rawHash, 'UNSUPPORTED_ACTIVITY_TYPE');
            warningCount += 1;
            continue;
          }
          const result = await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).ingestActivitySnapshot({
            batchId: requireBatch(batchId), connectionId: job.connectionId, providerActivityId: activity.providerActivityId,
            providerUpdatedAt: activity.providerUpdatedAt, identityFingerprint: stravaActivityFingerprint(activity), rawHash, raw,
            activity: {
              activityDate: activity.localDate, startTime: activity.startDate, activityType: canonicalType, subtype: subtype(activity),
              distanceM: finiteOrNull(activity.distanceM), durationS: finiteOrNull(activity.elapsedTimeS), movingTimeS: finiteOrNull(activity.movingTimeS),
              calories: integerOrNull(activity.calories), avgHr: integerOrNull(activity.averageHeartrate), maxHr: integerOrNull(activity.maxHeartrate),
              elevationGainM: finiteOrNull(activity.elevationGainM), avgSpeedMps: finiteOrNull(activity.averageSpeedMps),
              avgPaceSPerKm: pace(activity), notes: activity.name?.slice(0, 500) ?? null,
            },
          }));
          if (result.activityId) activityCount += 1;
          if (result.performanceEventWritten) performanceCount += 1;
          if (result.warning) warningCount += 1;
        }

        const cursor: Json = { page: page + 1, highWatermark: highWatermark?.toISOString() ?? null, rawCount, activityCount, performanceCount, warningCount };
        await this.withOwner(job.ownerId, async (db) => {
          await new ImportsRepository(db).updateBatchCounts(requireBatch(batchId), { row_count: rawCount, normalized_count: activityCount, warning_count: warningCount, status: 'normalized' }, 'provider-page-committed');
          await new ProvidersRepository(db).updateCursor(job.id, this.workerId, cursor, Math.min(95, 10 + page));
        });

        if (fetched.rateLimit.retryAt) {
          await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).reschedule(
            job.id,
            this.workerId,
            fetched.rateLimit.retryAt!,
            'PROVIDER_RATE_LIMITED',
            'Provider rate limit reached; sync will resume from the committed cursor.',
          ));
          return;
        }
      }

      await this.withOwner(job.ownerId, async (db) => {
        await new ImportsRepository(db).updateBatchCounts(requireBatch(batchId), { row_count: rawCount, normalized_count: activityCount, warning_count: warningCount, status: 'scored' }, 'provider-sync-completed');
        await new ProvidersRepository(db).markSucceeded(job.id, this.workerId, { rawRecords: rawCount, activities: activityCount, performanceEvents: performanceCount, warnings: warningCount, pages: Math.max(0, page - startPage) }, highWatermark);
      });
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : null;
      const code = providerError?.code ?? 'PROVIDER_SYNC_FAILED';
      const message = safeErrorMessage(error);
      if (providerError?.code === 'PROVIDER_REAUTHORIZATION_REQUIRED') await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).markReauthorizationRequired(job.connectionId, code, message)).catch(() => undefined);
      if (batchId) await this.withOwner(job.ownerId, (db) => new ImportsRepository(db).markBatchFailed(batchId!, { phase: 'provider-sync', error: new Error(message) })).catch(() => undefined);
      await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).markFailed(job.id, this.workerId, code, message)).catch(() => undefined);
      throw error;
    }
  }

  private async loadAuthorization(job: DispatchedProviderSync): Promise<ProviderAuthorization> {
    const stored = await this.withOwner(job.ownerId, (db) => new ProvidersRepository(db).loadWorkerAuthorization(job.connectionId));
    if (!stored) throw new ProviderError('PROVIDER_REAUTHORIZATION_REQUIRED', 'Provider authorization is unavailable.', false);
    return this.credentialCipher.decrypt(job.connectionId, job.ownerId, stored.connection.provider, {
      keyId: stored.credential.key_id, algorithm: stored.credential.algorithm, nonce: stored.credential.nonce,
      ciphertext: stored.credential.ciphertext, authenticationTag: stored.credential.authentication_tag,
      envelopeVersion: stored.credential.envelope_version,
    });
  }

  private async createBatch(job: DispatchedProviderSync): Promise<string> {
    return this.withOwner(job.ownerId, async (db) => {
      const batch = await new ImportsRepository(db).createBatch({
        source: 'strava_api', sourceKind: 'strava', metadata: { provider: 'strava', connectionId: job.connectionId, providerSyncJobId: job.id, mode: job.mode, requestedAfter: job.requestedAfter?.toISOString() ?? null, requestedBefore: job.requestedBefore?.toISOString() ?? null },
      });
      await new ProvidersRepository(db).linkBatch(job.id, this.workerId, batch.id);
      return batch.id;
    });
  }

  private async recordSkipped(ownerId: string, batchId: string, activity: ProviderActivity, raw: Json, rawHash: string, code: string): Promise<void> {
    await this.withOwner(ownerId, async (db) => {
      const records: NewSourceRecord[] = [{ import_batch_id: batchId, source: 'strava_api', sheet_name: null, row_index: null, source_record_key: activity.providerActivityId, row_hash: rawHash, raw_json: raw, normalized_entity_type: null, normalized_entity_id: null, status: 'skipped', errors: [], warnings: [{ code, message: `Unsupported Strava activity type ${activity.sportType ?? activity.type}.` }] }];
      await new ImportsRepository(db).insertSourceRecords(records);
    });
  }
  private withOwner<T>(ownerId: string, callback: (db: Kysely<Database>) => Promise<T>): Promise<T> { return withAccountContext(this.dataDb, ownerId, callback); }
}

function cursorObject(cursor: Json): Record<string, Json> { return typeof cursor === 'object' && cursor !== null && !Array.isArray(cursor) ? cursor : {}; }
function cursorPage(cursor: Json): number { const value = cursorObject(cursor).page; return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? Math.min(value, 100_000) : 1; }
function cursorCount(cursor: Json, key: string): number { const value = cursorObject(cursor)[key]; return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0; }
function cursorHighWatermark(cursor: Json): Date | null { const value = cursorObject(cursor).highWatermark; if (typeof value !== 'string') return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
function subtype(activity: ProviderActivity): 'outdoor' | 'indoor' | 'treadmill' | 'manual' | 'race' | 'unknown' { if (activity.isManual) return 'manual'; if (activity.isRace) return 'race'; if (activity.isIndoor && canonicalActivityType(activity) === 'run') return 'treadmill'; return activity.isIndoor ? 'indoor' : 'outdoor'; }
function pace(activity: ProviderActivity): number | null { const duration = activity.movingTimeS ?? activity.elapsedTimeS; return activity.distanceM !== null && duration !== null && activity.distanceM > 0 && duration >= 0 ? duration / (activity.distanceM / 1000) : null; }
function finiteOrNull(value: number | null): number | null { return value !== null && Number.isFinite(value) && value >= 0 ? value : null; }
export function integerOrNull(value: number | null): number | null { const finite = finiteOrNull(value); return finite === null ? null : Math.round(finite); }
function boundedRaw(value: Record<string, unknown>): Json { const serialized = JSON.stringify(value); if (serialized.length <= 256_000) return JSON.parse(serialized) as Json; const safe = { ...value }; delete safe.map; delete safe.polyline; delete safe.summary_polyline; delete safe.start_latlng; delete safe.end_latlng; const reduced = JSON.stringify(safe); return reduced.length <= 256_000 ? JSON.parse(reduced) as Json : { id: String(value.id ?? ''), truncated: true }; }
function hashJson(value: Json): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function safeErrorMessage(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/(access|refresh|client)[-_ ]?(token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1_$2=[redacted]').replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]').slice(0, 500); }
function requireBatch(value: string | null): string { if (!value) throw new Error('Provider sync batch is unavailable.'); return value; }
function safeWorkerId(value: string): string { return value.trim().slice(0, 200) || 'sportos-provider-worker'; }
function clampInteger(value: number, minimum: number, maximum: number): number { if (!Number.isFinite(value)) return minimum; return Math.min(maximum, Math.max(minimum, Math.trunc(value))); }
function delay(milliseconds: number, signal: AbortSignal): Promise<void> { return new Promise((resolve) => { if (signal.aborted) return resolve(); const timer = setTimeout(resolve, milliseconds); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); }); }
