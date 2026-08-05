import { sql, type Kysely, type Updateable } from 'kysely';
import type {
  Activity,
  ActivitiesTable,
  Database,
  Json,
  ProviderConnection,
  ProviderCredential,
  ProviderConnectionsTable,
  ProviderSyncJob,
} from '../schema.js';

export type ProviderSyncMode = ProviderSyncJob['mode'];
export type ProviderSyncStatus = ProviderSyncJob['status'];

export interface ProviderConnectionReadModel {
  id: string;
  provider: 'strava';
  displayName: string | null;
  scopes: string[];
  status: ProviderConnection['status'];
  accessExpiresAt: string | null;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  disconnectedAt: string | null;
  revokedAt: string | null;
}

export interface ProviderSyncJobReadModel {
  id: string;
  connectionId: string;
  mode: ProviderSyncMode;
  batchId: string | null;
  status: ProviderSyncStatus;
  phase: string;
  progressPercent: number;
  attemptCount: number;
  maxAttempts: number;
  cancellationRequested: boolean;
  requestedAfter: string | null;
  requestedBefore: string | null;
  error: { code: string; message: string } | null;
  result: Json;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CredentialEnvelopeRecord {
  keyId: string;
  algorithm: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
  envelopeVersion: 1;
}

export interface ProviderWorkerAuthorization {
  connection: ProviderConnection;
  credential: ProviderCredential;
}

export interface ProviderActivitySnapshotInput {
  batchId: string;
  connectionId: string;
  providerActivityId: string;
  providerUpdatedAt: Date | null;
  identityFingerprint: string;
  rawHash: string;
  raw: Json;
  activity: {
    activityDate: string;
    startTime: Date;
    activityType: Exclude<ActivitiesTable['activity_type'], 'steps' | 'hiit' | 'power_bonus'>;
    subtype: NonNullable<ActivitiesTable['subtype']>;
    distanceM: number | null;
    durationS: number | null;
    movingTimeS: number | null;
    calories: number | null;
    avgHr: number | null;
    maxHr: number | null;
    elevationGainM: number | null;
    avgSpeedMps: number | null;
    avgPaceSPerKm: number | null;
    notes: string | null;
  };
}

export interface ProviderActivityIngestionResult {
  sourceRecordId: string;
  activityId: string | null;
  insertedActivity: boolean;
  linkedExistingActivity: boolean;
  performanceEventWritten: boolean;
  warning: 'POTENTIAL_DUPLICATE' | null;
}

export class ActiveProviderSyncJobError extends Error {
  constructor(readonly jobId: string) { super(`Provider connection already has active sync job ${jobId}.`); this.name = 'ActiveProviderSyncJobError'; }
}
export class ProviderSyncQueueFullError extends Error {
  constructor(readonly limit: number) { super(`The provider sync queue already contains ${limit} active jobs.`); this.name = 'ProviderSyncQueueFullError'; }
}
export class ProviderSyncStateError extends Error {
  constructor(readonly code: 'NOT_CONNECTED' | 'NOT_RETRYABLE' | 'ATTEMPTS_EXHAUSTED' | 'LOST_LEASE', message: string) { super(message); this.name = 'ProviderSyncStateError'; }
}

const PROVIDER_QUEUE_LOCK = 834_110_215;

export class ProvidersRepository {
  constructor(private readonly db: Kysely<Database>, private readonly queueLimit = 10) {}

  async createOauthTransaction(input: { stateHash: string; provider: 'strava'; returnTo: string; expiresAt: Date }): Promise<void> {
    await this.db.deleteFrom('provider_oauth_transactions').where('expires_at', '<', new Date()).execute();
    await this.db.insertInto('provider_oauth_transactions').values({ state_hash: input.stateHash, provider: input.provider, return_to: safeReturnTo(input.returnTo), expires_at: input.expiresAt }).execute();
  }

  async consumeOauthTransaction(stateHash: string): Promise<{ provider: 'strava'; returnTo: string } | null> {
    const row = await this.db.deleteFrom('provider_oauth_transactions').where('state_hash', '=', stateHash).where('expires_at', '>', new Date()).returning(['provider', 'return_to']).executeTakeFirst();
    return row ? { provider: row.provider, returnTo: row.return_to } : null;
  }

  async listConnections(): Promise<ProviderConnectionReadModel[]> {
    return (await this.db.selectFrom('provider_connections').selectAll().orderBy('created_at', 'asc').orderBy('id', 'asc').execute()).map(mapConnection);
  }

  async getConnection(connectionId: string): Promise<ProviderConnectionReadModel | null> {
    const row = await this.db.selectFrom('provider_connections').selectAll().where('id', '=', connectionId).executeTakeFirst();
    return row ? mapConnection(row) : null;
  }

  async loadWorkerAuthorization(connectionId: string): Promise<ProviderWorkerAuthorization | null> {
    const row = await this.db.selectFrom('provider_connections as c')
      .innerJoin('provider_credentials as k', (join) => join.onRef('k.owner_id', '=', 'c.owner_id').onRef('k.connection_id', '=', 'c.id'))
      .select([
        'c.id as connection_id', 'c.owner_id', 'c.provider', 'c.provider_account_id', 'c.display_name', 'c.scopes', 'c.status',
        'c.access_expires_at', 'c.cursor_json', 'c.last_sync_at', 'c.last_attempt_at', 'c.last_error_code', 'c.last_error_message',
        'c.created_at as connection_created_at', 'c.updated_at as connection_updated_at', 'c.disconnected_at', 'c.revoked_at',
        'k.key_id', 'k.algorithm', 'k.nonce', 'k.ciphertext', 'k.authentication_tag', 'k.envelope_version',
        'k.created_at as credential_created_at', 'k.rotated_at',
      ])
      .where('c.id', '=', connectionId).where('c.status', '=', 'connected').executeTakeFirst();
    if (!row) return null;
    return {
      connection: {
        id: row.connection_id, owner_id: row.owner_id, provider: row.provider, provider_account_id: row.provider_account_id,
        display_name: row.display_name, scopes: row.scopes, status: row.status, access_expires_at: row.access_expires_at,
        cursor_json: row.cursor_json, last_sync_at: row.last_sync_at, last_attempt_at: row.last_attempt_at,
        last_error_code: row.last_error_code, last_error_message: row.last_error_message,
        created_at: row.connection_created_at, updated_at: row.connection_updated_at, disconnected_at: row.disconnected_at, revoked_at: row.revoked_at,
      },
      credential: {
        connection_id: row.connection_id, owner_id: row.owner_id, key_id: row.key_id, algorithm: row.algorithm, nonce: row.nonce,
        ciphertext: row.ciphertext, authentication_tag: row.authentication_tag, envelope_version: row.envelope_version,
        created_at: row.credential_created_at, rotated_at: row.rotated_at,
      },
    };
  }

  async replaceCredential(connectionId: string, credential: CredentialEnvelopeRecord, accessExpiresAt: Date): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const connection = await tx.selectFrom('provider_connections').select(['id', 'status']).where('id', '=', connectionId).forUpdate().executeTakeFirst();
      if (!connection || connection.status !== 'connected') throw new ProviderSyncStateError('NOT_CONNECTED', 'Provider connection is no longer connected.');
      const updated = await tx.updateTable('provider_credentials').set({
        key_id: credential.keyId, algorithm: credential.algorithm, nonce: credential.nonce, ciphertext: credential.ciphertext,
        authentication_tag: credential.authenticationTag, envelope_version: credential.envelopeVersion, rotated_at: new Date(),
      }).where('connection_id', '=', connectionId).returning('connection_id').executeTakeFirst();
      if (!updated) throw new ProviderSyncStateError('NOT_CONNECTED', 'Provider credentials are unavailable.');
      await tx.updateTable('provider_connections').set({ access_expires_at: accessExpiresAt, updated_at: new Date() }).where('id', '=', connectionId).execute();
    });
  }

  async enqueueSync(input: { connectionId: string; mode: ProviderSyncMode; requestedAfter?: Date | null; requestedBefore?: Date | null; maxAttempts?: number }): Promise<ProviderSyncJobReadModel> {
    return this.db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(${PROVIDER_QUEUE_LOCK})`.execute(tx);
      const connection = await tx.selectFrom('provider_connections').select(['id', 'status', 'cursor_json']).where('id', '=', input.connectionId).forUpdate().executeTakeFirst();
      if (!connection || connection.status !== 'connected') throw new ProviderSyncStateError('NOT_CONNECTED', 'Provider connection is not connected.');
      const active = await tx.selectFrom('provider_sync_jobs').select('id').where('connection_id', '=', input.connectionId).where('status', 'in', ['queued', 'running']).executeTakeFirst();
      if (active) throw new ActiveProviderSyncJobError(active.id);
      const count = await tx.selectFrom('provider_sync_jobs').select((eb) => eb.fn.countAll<number>().as('count')).where('status', 'in', ['queued', 'running']).executeTakeFirstOrThrow();
      const limit = clampInteger(this.queueLimit, 1, 1000);
      if (Number(count.count) >= limit) throw new ProviderSyncQueueFullError(limit);
      const cursor = jsonObject(connection.cursor_json);
      const highWatermark = typeof cursor.highWatermark === 'string' ? parseDate(cursor.highWatermark) : null;
      const overlapAfter = input.mode === 'incremental' && highWatermark ? new Date(highWatermark.getTime() - 6 * 60 * 60 * 1000) : null;
      const row = await tx.insertInto('provider_sync_jobs').values({
        connection_id: input.connectionId, import_batch_id: null, mode: input.mode, status: 'queued', phase: 'queued', progress_percent: 0,
        attempt_count: 0, max_attempts: clampInteger(input.maxAttempts ?? 5, 1, 20), lease_owner: null, lease_expires_at: null,
        heartbeat_at: null, cancellation_requested_at: null, next_attempt_at: new Date(), requested_after: input.requestedAfter ?? overlapAfter,
        requested_before: input.requestedBefore ?? new Date(), cursor_json: { page: 1 }, error_code: null, error_message: null,
        result_json: {}, started_at: null, completed_at: null,
      }).returningAll().executeTakeFirstOrThrow();
      return mapJob(row);
    });
  }

  async getSyncJob(jobId: string): Promise<ProviderSyncJobReadModel | null> {
    const row = await this.db.selectFrom('provider_sync_jobs').selectAll().where('id', '=', jobId).executeTakeFirst();
    return row ? mapJob(row) : null;
  }
  async listSyncJobs(connectionId: string, limit = 20): Promise<ProviderSyncJobReadModel[]> {
    return (await this.db.selectFrom('provider_sync_jobs').selectAll().where('connection_id', '=', connectionId).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(clampInteger(limit, 1, 100)).execute()).map(mapJob);
  }

  async retrySync(jobId: string): Promise<ProviderSyncJobReadModel | null> {
    return this.db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(${PROVIDER_QUEUE_LOCK})`.execute(tx);
      const job = await tx.selectFrom('provider_sync_jobs').selectAll().where('id', '=', jobId).forUpdate().executeTakeFirst();
      if (!job) return null;
      if (job.status !== 'failed') throw new ProviderSyncStateError('NOT_RETRYABLE', 'Only failed provider sync jobs can be retried.');
      if (job.attempt_count >= job.max_attempts) throw new ProviderSyncStateError('ATTEMPTS_EXHAUSTED', 'This provider sync job has exhausted its retry attempts.');
      const connection = await tx.selectFrom('provider_connections').select('status').where('id', '=', job.connection_id).executeTakeFirst();
      if (!connection || connection.status !== 'connected') throw new ProviderSyncStateError('NOT_CONNECTED', 'Provider connection is not connected.');
      const updated = await tx.updateTable('provider_sync_jobs').set({
        status: 'queued', phase: 'queued', progress_percent: 0, lease_owner: null, lease_expires_at: null, heartbeat_at: null,
        cancellation_requested_at: null, next_attempt_at: new Date(), error_code: null, error_message: null, completed_at: null, updated_at: new Date(),
      }).where('id', '=', jobId).returningAll().executeTakeFirstOrThrow();
      return mapJob(updated);
    });
  }

  async requestCancellation(jobId: string): Promise<ProviderSyncJobReadModel | null> {
    return this.db.transaction().execute(async (tx) => {
      const job = await tx.selectFrom('provider_sync_jobs').selectAll().where('id', '=', jobId).forUpdate().executeTakeFirst();
      if (!job) return null;
      if (job.status === 'queued') {
        await tx.updateTable('provider_sync_jobs').set({ status: 'cancelled', phase: 'cancelled', cancellation_requested_at: new Date(), completed_at: new Date(), updated_at: new Date() }).where('id', '=', jobId).execute();
      } else if (job.status === 'running' && job.cancellation_requested_at === null) {
        await tx.updateTable('provider_sync_jobs').set({ cancellation_requested_at: new Date(), phase: 'cancelling', updated_at: new Date() }).where('id', '=', jobId).execute();
      }
      return mapJob(await tx.selectFrom('provider_sync_jobs').selectAll().where('id', '=', jobId).executeTakeFirstOrThrow());
    });
  }

  async disconnect(connectionId: string, status: 'disconnected' | 'revoked' = 'disconnected'): Promise<boolean> {
    return this.db.transaction().execute(async (tx) => {
      const connection = await tx.selectFrom('provider_connections').select('id').where('id', '=', connectionId).forUpdate().executeTakeFirst();
      if (!connection) return false;
      const now = new Date();
      await tx.deleteFrom('provider_credentials').where('connection_id', '=', connectionId).execute();
      await tx.updateTable('provider_sync_jobs').set({ status: 'cancelled', phase: 'cancelled', cancellation_requested_at: now, completed_at: now, updated_at: now }).where('connection_id', '=', connectionId).where('status', '=', 'queued').execute();
      await tx.updateTable('provider_sync_jobs').set({ phase: 'cancelling', cancellation_requested_at: now, updated_at: now }).where('connection_id', '=', connectionId).where('status', '=', 'running').execute();
      await tx.updateTable('provider_connections').set({ status, disconnected_at: status === 'disconnected' ? now : null, revoked_at: status === 'revoked' ? now : null, updated_at: now }).where('id', '=', connectionId).execute();
      return true;
    });
  }

  async markReauthorizationRequired(connectionId: string, code: string, message: string): Promise<void> {
    await this.db.updateTable('provider_connections').set({ status: 'reauthorization_required', last_error_code: safeCode(code), last_error_message: redact(message), updated_at: new Date() }).where('id', '=', connectionId).execute();
  }

  async heartbeat(jobId: string, workerId: string, phase: string, progress: number, leaseSeconds = 60): Promise<void> {
    await requireLease(this.db.updateTable('provider_sync_jobs').set({
      phase: safeText(phase, 100, 'phase'), progress_percent: sql<number>`greatest(progress_percent, ${clampInteger(progress, 0, 99)})`,
      heartbeat_at: new Date(), lease_expires_at: sql<Date>`now() + make_interval(secs => ${clampInteger(leaseSeconds, 15, 600)})`, updated_at: new Date(),
    }).where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).returning('id').executeTakeFirst(), 'The worker no longer owns this provider sync lease.');
  }

  async cancellationRequested(jobId: string, workerId: string): Promise<boolean> {
    const row = await this.db.selectFrom('provider_sync_jobs').select('cancellation_requested_at').where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).executeTakeFirst();
    if (!row) throw new ProviderSyncStateError('LOST_LEASE', 'The worker no longer owns this provider sync lease.');
    return row.cancellation_requested_at !== null;
  }

  async linkBatch(jobId: string, workerId: string, batchId: string): Promise<void> {
    await requireLease(this.db.updateTable('provider_sync_jobs').set({ import_batch_id: batchId, updated_at: new Date() }).where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).returning('id').executeTakeFirst(), 'The worker cannot link a batch after losing its lease.');
  }

  async updateCursor(jobId: string, workerId: string, cursor: Json, progress: number): Promise<void> {
    await requireLease(this.db.updateTable('provider_sync_jobs').set({ cursor_json: cursor, progress_percent: sql<number>`greatest(progress_percent, ${clampInteger(progress, 0, 99)})`, updated_at: new Date() }).where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).returning('id').executeTakeFirst(), 'The worker no longer owns this provider sync lease.');
  }

  async reschedule(jobId: string, workerId: string, nextAttemptAt: Date, code: string, message: string): Promise<void> {
    await requireLease(this.db.updateTable('provider_sync_jobs').set({
      status: 'queued', phase: 'rate-limited', attempt_count: sql<number>`greatest(attempt_count - 1, 0)`, lease_owner: null,
      lease_expires_at: null, heartbeat_at: new Date(), next_attempt_at: nextAttemptAt, error_code: safeCode(code), error_message: redact(message), updated_at: new Date(),
    }).where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).returning('id').executeTakeFirst(), 'The worker cannot reschedule after losing its lease.');
  }

  async markSucceeded(jobId: string, workerId: string, result: Json, highWatermark: Date | null): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const job = await tx.updateTable('provider_sync_jobs').set({ status: 'succeeded', phase: 'completed', progress_percent: 100, lease_owner: null, lease_expires_at: null, heartbeat_at: new Date(), result_json: result, error_code: null, error_message: null, completed_at: new Date(), updated_at: new Date() }).where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).returning('connection_id').executeTakeFirst();
      if (!job) throw new ProviderSyncStateError('LOST_LEASE', 'The worker cannot complete after losing its lease.');
      const update: Updateable<ProviderConnectionsTable> = { last_sync_at: new Date(), last_attempt_at: new Date(), last_error_code: null, last_error_message: null, updated_at: new Date() };
      if (highWatermark) update.cursor_json = { highWatermark: highWatermark.toISOString() };
      await tx.updateTable('provider_connections').set(update).where('id', '=', job.connection_id).execute();
    });
  }

  async markFailed(jobId: string, workerId: string, code: string, message: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const job = await tx.updateTable('provider_sync_jobs').set({ status: 'failed', phase: 'failed', lease_owner: null, lease_expires_at: null, heartbeat_at: new Date(), error_code: safeCode(code), error_message: redact(message), completed_at: new Date(), updated_at: new Date() }).where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).returning('connection_id').executeTakeFirst();
      if (!job) throw new ProviderSyncStateError('LOST_LEASE', 'The worker cannot fail a job after losing its lease.');
      await tx.updateTable('provider_connections').set({ last_attempt_at: new Date(), last_error_code: safeCode(code), last_error_message: redact(message), updated_at: new Date() }).where('id', '=', job.connection_id).execute();
    });
  }

  async markCancelled(jobId: string, workerId: string): Promise<void> {
    await requireLease(this.db.updateTable('provider_sync_jobs').set({ status: 'cancelled', phase: 'cancelled', progress_percent: 100, lease_owner: null, lease_expires_at: null, heartbeat_at: new Date(), completed_at: new Date(), updated_at: new Date() }).where('id', '=', jobId).where('status', '=', 'running').where('lease_owner', '=', safeWorker(workerId)).returning('id').executeTakeFirst(), 'The worker cannot cancel after losing its lease.');
  }

  async ingestActivitySnapshot(input: ProviderActivitySnapshotInput): Promise<ProviderActivityIngestionResult> {
    return this.db.transaction().execute(async (tx) => {
      const source = await tx.insertInto('source_records').values({
        import_batch_id: input.batchId, source: 'strava_api', sheet_name: null, row_index: null, source_record_key: input.providerActivityId,
        row_hash: input.rawHash, raw_json: input.raw, normalized_entity_type: null, normalized_entity_id: null, status: 'raw', errors: [], warnings: [],
      }).onConflict((oc) => oc.columns(['owner_id', 'import_batch_id', 'source_record_key', 'row_hash']).doUpdateSet({ raw_json: sql`excluded.raw_json` })).returningAll().executeTakeFirstOrThrow();

      const existingLink = await tx.selectFrom('provider_activity_links').selectAll().where('connection_id', '=', input.connectionId).where('provider_activity_id', '=', input.providerActivityId).executeTakeFirst();
      let activity: Activity | null = null;
      let insertedActivity = false;
      let linkedExistingActivity = false;
      let warning: 'POTENTIAL_DUPLICATE' | null = null;

      if (existingLink) {
        const linked = await tx.selectFrom('activities').selectAll().where('id', '=', existingLink.activity_id).executeTakeFirst();
        if (linked?.source === 'strava') {
          activity = await tx.updateTable('activities').set(activityUpdate(input, source.id)).where('id', '=', linked.id).returningAll().executeTakeFirst() ?? null;
        } else {
          activity = linked ?? null;
          linkedExistingActivity = activity !== null;
        }
      } else {
        let candidateQuery = tx.selectFrom('activities').selectAll()
          .where('activity_type', '=', input.activity.activityType)
          .where('activity_date', '=', input.activity.activityDate)
          .where('start_time', '=', input.activity.startTime);
        candidateQuery = input.activity.distanceM === null ? candidateQuery.where('distance_m', 'is', null) : candidateQuery.where('distance_m', '=', input.activity.distanceM);
        candidateQuery = input.activity.movingTimeS === null ? candidateQuery.where('moving_time_s', 'is', null) : candidateQuery.where('moving_time_s', '=', input.activity.movingTimeS);
        const candidates = await candidateQuery.orderBy('id', 'asc').limit(2).execute();
        if (candidates.length === 1) { activity = candidates[0] ?? null; linkedExistingActivity = true; }
        else if (candidates.length > 1) warning = 'POTENTIAL_DUPLICATE';
        else {
          activity = await tx.insertInto('activities').values({
            source: 'strava', source_record_id: source.id, source_activity_id: input.providerActivityId, source_record_hash: input.identityFingerprint,
            activity_date: input.activity.activityDate, start_time: input.activity.startTime, activity_type: input.activity.activityType,
            subtype: input.activity.subtype, distance_m: input.activity.distanceM, duration_s: input.activity.durationS,
            moving_time_s: input.activity.movingTimeS, steps: null, calories: input.activity.calories, avg_hr: input.activity.avgHr,
            max_hr: input.activity.maxHr, elevation_gain_m: input.activity.elevationGainM, avg_speed_mps: input.activity.avgSpeedMps,
            avg_pace_s_per_km: input.activity.avgPaceSPerKm, effort_points: null, notes: input.activity.notes, raw_payload_json: {},
          }).onConflict((oc) => oc.columns(['owner_id', 'source', 'source_activity_id']).doUpdateSet(activityUpdate(input, source.id))).returningAll().executeTakeFirstOrThrow();
          insertedActivity = true;
        }
      }

      if (warning) {
        await tx.updateTable('source_records').set({ status: 'skipped', warnings: [{ code: warning, message: 'Multiple exact canonical activity candidates require explicit resolution.' }] }).where('id', '=', source.id).execute();
        return { sourceRecordId: source.id, activityId: null, insertedActivity: false, linkedExistingActivity: false, performanceEventWritten: false, warning };
      }
      if (!activity) throw new Error('Provider activity could not be resolved.');

      await tx.insertInto('provider_activity_links').values({
        connection_id: input.connectionId, provider_activity_id: input.providerActivityId, activity_id: activity.id,
        latest_source_record_id: source.id, identity_fingerprint: input.identityFingerprint, fingerprint_version: 1,
        availability: 'available', provider_updated_at: input.providerUpdatedAt,
      }).onConflict((oc) => oc.columns(['owner_id', 'connection_id', 'provider_activity_id']).doUpdateSet({
        activity_id: activity!.id, latest_source_record_id: source.id, identity_fingerprint: input.identityFingerprint,
        availability: 'available', provider_updated_at: input.providerUpdatedAt, updated_at: new Date(),
      })).execute();
      await tx.updateTable('source_records').set({ normalized_entity_type: 'activity', normalized_entity_id: activity.id, status: 'normalized', warnings: [] }).where('id', '=', source.id).execute();

      let performanceEventWritten = false;
      if (!linkedExistingActivity && input.activity.activityType === 'run' && input.activity.distanceM !== null && input.activity.durationS !== null && input.activity.distanceM > 0) {
        await tx.insertInto('performance_events').values({
          activity_id: activity.id, source_record_id: source.id, source_record_hash: input.identityFingerprint, source: 'strava',
          event_date: input.activity.activityDate, distance_m: input.activity.distanceM, duration_s: input.activity.durationS,
          pace_s_per_km: input.activity.durationS / (input.activity.distanceM / 1000), is_treadmill: input.activity.subtype === 'treadmill',
          is_race: input.activity.subtype === 'race', is_pr_marker: false, source_rank: null, tags: [], notes: input.activity.notes, raw_payload_json: {},
        }).onConflict((oc) => oc.columns(['owner_id', 'source', 'source_record_hash']).doUpdateSet({
          activity_id: activity!.id, source_record_id: source.id, event_date: input.activity.activityDate,
          distance_m: input.activity.distanceM!, duration_s: input.activity.durationS!,
          pace_s_per_km: input.activity.durationS! / (input.activity.distanceM! / 1000),
          is_treadmill: input.activity.subtype === 'treadmill', is_race: input.activity.subtype === 'race', notes: input.activity.notes,
        })).execute();
        performanceEventWritten = true;
      }
      return { sourceRecordId: source.id, activityId: activity.id, insertedActivity, linkedExistingActivity, performanceEventWritten, warning: null };
    });
  }
}

function activityUpdate(input: ProviderActivitySnapshotInput, sourceRecordId: string) {
  return {
    source_record_id: sourceRecordId, source_activity_id: input.providerActivityId, source_record_hash: input.identityFingerprint,
    activity_date: input.activity.activityDate, start_time: input.activity.startTime, activity_type: input.activity.activityType,
    subtype: input.activity.subtype, distance_m: input.activity.distanceM, duration_s: input.activity.durationS,
    moving_time_s: input.activity.movingTimeS, calories: input.activity.calories, avg_hr: input.activity.avgHr,
    max_hr: input.activity.maxHr, elevation_gain_m: input.activity.elevationGainM, avg_speed_mps: input.activity.avgSpeedMps,
    avg_pace_s_per_km: input.activity.avgPaceSPerKm, notes: input.activity.notes,
  };
}

async function requireLease<T>(promise: Promise<T | undefined>, message: string): Promise<void> {
  if (!await promise) throw new ProviderSyncStateError('LOST_LEASE', message);
}
function mapConnection(row: ProviderConnection): ProviderConnectionReadModel {
  return { id: row.id, provider: row.provider, displayName: row.display_name, scopes: row.scopes, status: row.status,
    accessExpiresAt: isoOrNull(row.access_expires_at), lastSyncAt: isoOrNull(row.last_sync_at), lastAttemptAt: isoOrNull(row.last_attempt_at),
    error: row.last_error_code && row.last_error_message ? { code: row.last_error_code, message: row.last_error_message } : null,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), disconnectedAt: isoOrNull(row.disconnected_at), revokedAt: isoOrNull(row.revoked_at) };
}
function mapJob(row: ProviderSyncJob): ProviderSyncJobReadModel {
  return { id: row.id, connectionId: row.connection_id, mode: row.mode, batchId: row.import_batch_id, status: row.status,
    phase: row.phase, progressPercent: row.progress_percent, attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    cancellationRequested: row.cancellation_requested_at !== null, requestedAfter: isoOrNull(row.requested_after), requestedBefore: isoOrNull(row.requested_before),
    error: row.error_code && row.error_message ? { code: row.error_code, message: row.error_message } : null, result: row.result_json,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), startedAt: isoOrNull(row.started_at), completedAt: isoOrNull(row.completed_at) };
}
function safeReturnTo(value: string): string { const text = safeText(value, 1000, 'return path'); return text.startsWith('/') && !text.startsWith('//') && !text.includes('\\') ? text : '/'; }
function safeWorker(value: string): string { return safeText(value, 200, 'worker id'); }
function safeCode(value: string): string { return (value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'PROVIDER_SYNC_FAILED').slice(0, 100); }
function redact(value: string): string { return value.replace(/(access|refresh|client)[-_ ]?(token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1_$2=[redacted]').replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]').slice(0, 500); }
function safeText(value: string, maximum: number, name: string): string { const text = value?.trim(); if (!text || text.length > maximum) throw new Error(`Invalid ${name}.`); return text; }
function clampInteger(value: number, minimum: number, maximum: number): number { return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.trunc(value))) : minimum; }
function jsonObject(value: Json): Record<string, Json> { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}; }
function parseDate(value: string): Date | null { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
function iso(value: unknown): string { const date = value instanceof Date ? value : new Date(String(value)); if (!Number.isFinite(date.getTime())) throw new Error('Invalid provider timestamp.'); return date.toISOString(); }
function isoOrNull(value: unknown | null): string | null { return value === null ? null : iso(value); }
