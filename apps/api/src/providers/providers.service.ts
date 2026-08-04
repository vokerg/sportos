import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ActiveProviderSyncJobError,
  ProviderSyncQueueFullError,
  ProviderSyncStateError,
  ProvidersRepository,
  sql,
  type Json,
  type ProviderConnectionReadModel,
  type ProviderSyncJobReadModel,
  type ProviderSyncMode,
} from '@sportos/db';
import {
  CredentialCipher,
  ProviderError,
  StravaAdapter,
  parseCredentialKeyRing,
  type ProviderAuthorization,
} from '@sportos/providers';
import { DbProvider } from '../db.provider.js';

export interface StartProviderConnectionResult {
  authorizationUrl: string;
}

export interface CompleteProviderConnectionResult {
  connection: ProviderConnectionReadModel;
  returnTo: string;
}

@Injectable()
export class ProvidersService {
  constructor(private readonly dbProvider: DbProvider) {}

  async startStrava(accountId: string, returnTo = '/'): Promise<StartProviderConnectionResult> {
    const state = randomBytes(32).toString('base64url');
    const stateHash = sha256(state);
    await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).createOauthTransaction({
      stateHash,
      provider: 'strava',
      returnTo: safeReturnTo(returnTo),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }));
    const url = this.stravaAdapter().createAuthorizationUrl({
      state,
      redirectUri: this.redirectUri(),
      scopes: ['read', 'activity:read_all'],
    });
    return { authorizationUrl: url.toString() };
  }

  async completeStrava(
    accountId: string,
    input: { state?: string; code?: string; scope?: string; providerError?: string },
  ): Promise<CompleteProviderConnectionResult> {
    if (input.providerError) {
      throw new BadRequestException({ code: 'PROVIDER_AUTHORIZATION_DENIED', message: 'Provider authorization was not completed.' });
    }
    const state = requiredText(input.state, 500, 'state');
    const code = requiredText(input.code, 2000, 'code');
    const transaction = await this.dbProvider.withAccount(accountId, (db) =>
      new ProvidersRepository(db).consumeOauthTransaction(sha256(state)),
    );
    if (!transaction || transaction.provider !== 'strava') {
      throw new BadRequestException({ code: 'PROVIDER_OAUTH_STATE_INVALID', message: 'Provider authorization state is invalid or expired.' });
    }
    const scopes = parseGrantedScopes(input.scope);
    if (!scopes.includes('activity:read_all')) {
      throw new BadRequestException({ code: 'PROVIDER_SCOPE_MISSING', message: 'Strava activity read permission is required.' });
    }

    let authorization: ProviderAuthorization;
    try {
      authorization = await this.stravaAdapter().exchangeAuthorizationCode({ code, redirectUri: this.redirectUri() });
      authorization = { ...authorization, scopes };
    } catch (error) {
      throw providerHttpException(error);
    }

    try {
      const connection = await this.persistAuthorization(accountId, authorization);
      return { connection, returnTo: transaction.returnTo };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'PROVIDER_CONNECTION_UNAVAILABLE',
          message: 'This provider authorization cannot be connected.',
        });
      }
      throw error;
    }
  }

  listConnections(accountId: string): Promise<ProviderConnectionReadModel[]> {
    return this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).listConnections());
  }

  async enqueueSync(
    accountId: string,
    connectionId: string,
    input: { mode?: string; after?: string; before?: string },
  ): Promise<ProviderSyncJobReadModel> {
    const mode = parseMode(input.mode);
    const requestedAfter = optionalTimestamp(input.after, 'after');
    const requestedBefore = optionalTimestamp(input.before, 'before');
    if (requestedAfter && requestedBefore && requestedAfter >= requestedBefore) {
      throw new BadRequestException({ code: 'INVALID_PROVIDER_SYNC_RANGE', message: 'after must be earlier than before.' });
    }
    try {
      return await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).enqueueSync({
        connectionId,
        mode,
        requestedAfter,
        requestedBefore,
      }));
    } catch (error) {
      if (error instanceof ActiveProviderSyncJobError) {
        throw new ConflictException({ code: 'ACTIVE_PROVIDER_SYNC_EXISTS', message: 'This provider connection already has an active sync.', jobId: error.jobId });
      }
      if (error instanceof ProviderSyncQueueFullError) {
        throw new ServiceUnavailableException({ code: 'PROVIDER_SYNC_QUEUE_FULL', message: 'The provider sync queue is full. Try again later.' });
      }
      if (error instanceof ProviderSyncStateError) throw providerStateException(error, connectionId);
      throw error;
    }
  }

  async getSyncJob(accountId: string, jobId: string): Promise<ProviderSyncJobReadModel> {
    const job = await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).getSyncJob(jobId));
    if (!job) throw providerJobNotFound();
    return job;
  }

  async listSyncJobs(accountId: string, connectionId: string, limit = 20): Promise<ProviderSyncJobReadModel[]> {
    const connection = await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).getConnection(connectionId));
    if (!connection) throw providerConnectionNotFound();
    return this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).listSyncJobs(connectionId, limit));
  }

  async retrySync(accountId: string, jobId: string): Promise<ProviderSyncJobReadModel> {
    try {
      const job = await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).retrySync(jobId));
      if (!job) throw providerJobNotFound();
      return job;
    } catch (error) {
      if (error instanceof ProviderSyncStateError) throw providerStateException(error, jobId);
      throw error;
    }
  }

  async cancelSync(accountId: string, jobId: string): Promise<ProviderSyncJobReadModel> {
    const job = await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).requestCancellation(jobId));
    if (!job) throw providerJobNotFound();
    return job;
  }

  async disconnect(accountId: string, connectionId: string): Promise<{ disconnected: true }> {
    const stored = await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).loadWorkerAuthorization(connectionId));
    if (!stored) {
      const connection = await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).getConnection(connectionId));
      if (!connection) throw providerConnectionNotFound();
    } else {
      try {
        const authorization = this.credentialCipher().decrypt(connectionId, accountId, stored.connection.provider, envelopeFromRow(stored.credential));
        await this.stravaAdapter().revokeAuthorization(authorization);
      } catch {
        // Local disconnect must still remove credentials and stop future work.
      }
    }
    const disconnected = await this.dbProvider.withAccount(accountId, (db) => new ProvidersRepository(db).disconnect(connectionId));
    if (!disconnected) throw providerConnectionNotFound();
    return { disconnected: true };
  }

  private async persistAuthorization(accountId: string, authorization: ProviderAuthorization): Promise<ProviderConnectionReadModel> {
    return this.dbProvider.withAccount(accountId, async (db) => db.transaction().execute(async (transaction) => {
      const existing = await transaction.selectFrom('provider_connections').select(['id'])
        .where('provider', '=', 'strava').executeTakeFirst();
      const connectionId = existing?.id ?? randomUUID();
      const envelope = this.credentialCipher().encrypt(connectionId, accountId, 'strava', authorization);
      const connection = await transaction.insertInto('provider_connections').values({
        id: connectionId,
        provider: 'strava',
        provider_account_id: authorization.providerAccountId,
        display_name: authorization.displayName,
        scopes: authorization.scopes,
        status: 'connected',
        access_expires_at: authorization.expiresAt,
        cursor_json: existing ? sql<Json>`cursor_json` : {},
        last_error_code: null,
        last_error_message: null,
        disconnected_at: null,
        revoked_at: null,
      }).onConflict((oc) => oc.columns(['owner_id', 'provider']).doUpdateSet({
        provider_account_id: sql`excluded.provider_account_id`,
        display_name: sql`excluded.display_name`,
        scopes: sql`excluded.scopes`,
        status: 'connected',
        access_expires_at: sql`excluded.access_expires_at`,
        last_error_code: null,
        last_error_message: null,
        disconnected_at: null,
        revoked_at: null,
        updated_at: new Date(),
      })).returningAll().executeTakeFirstOrThrow();
      await transaction.insertInto('provider_credentials').values({
        connection_id: connection.id,
        key_id: envelope.keyId,
        algorithm: envelope.algorithm,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        authentication_tag: envelope.authenticationTag,
        envelope_version: envelope.envelopeVersion,
      }).onConflict((oc) => oc.column('connection_id').doUpdateSet({
        key_id: envelope.keyId,
        algorithm: envelope.algorithm,
        nonce: envelope.nonce,
        ciphertext: envelope.ciphertext,
        authentication_tag: envelope.authenticationTag,
        envelope_version: envelope.envelopeVersion,
        rotated_at: new Date(),
      })).execute();
      return {
        id: connection.id,
        provider: connection.provider,
        displayName: connection.display_name,
        scopes: connection.scopes,
        status: connection.status,
        accessExpiresAt: toIsoOrNull(connection.access_expires_at),
        lastSyncAt: toIsoOrNull(connection.last_sync_at),
        lastAttemptAt: toIsoOrNull(connection.last_attempt_at),
        error: null,
        createdAt: toIso(connection.created_at),
        updatedAt: toIso(connection.updated_at),
        disconnectedAt: toIsoOrNull(connection.disconnected_at),
        revokedAt: toIsoOrNull(connection.revoked_at),
      };
    }));
  }

  private stravaAdapter(): StravaAdapter {
    return new StravaAdapter({
      clientId: requiredEnvironment('STRAVA_CLIENT_ID'),
      clientSecret: requiredEnvironment('STRAVA_CLIENT_SECRET'),
      authorizationBaseUrl: process.env.STRAVA_AUTH_BASE_URL,
      apiBaseUrl: process.env.STRAVA_API_BASE_URL,
    });
  }

  private credentialCipher(): CredentialCipher {
    return new CredentialCipher(parseCredentialKeyRing(
      requiredEnvironment('SPORTOS_PROVIDER_CREDENTIAL_KEYS'),
      requiredEnvironment('SPORTOS_PROVIDER_ACTIVE_KEY_ID'),
    ));
  }

  private redirectUri(): string {
    return requiredEnvironment('STRAVA_REDIRECT_URI');
  }
}

function envelopeFromRow(row: {
  key_id: string;
  algorithm: 'aes-256-gcm';
  nonce: string;
  ciphertext: string;
  authentication_tag: string;
  envelope_version: 1;
}) {
  return {
    keyId: row.key_id,
    algorithm: row.algorithm,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    authenticationTag: row.authentication_tag,
    envelopeVersion: row.envelope_version,
  } as const;
}

function providerHttpException(error: unknown): Error {
  if (error instanceof ProviderError) {
    if (error.retryable) return new ServiceUnavailableException({ code: error.code, message: error.message });
    return new BadRequestException({ code: error.code, message: error.message });
  }
  return new InternalServerErrorException({ code: 'PROVIDER_AUTHORIZATION_FAILED', message: 'Provider authorization failed.' });
}

function providerStateException(error: ProviderSyncStateError, referenceId: string): Error {
  return new ConflictException({ code: error.code, message: error.message, referenceId });
}

function providerConnectionNotFound(): NotFoundException {
  return new NotFoundException({ code: 'PROVIDER_CONNECTION_NOT_FOUND', message: 'Provider connection was not found.' });
}

function providerJobNotFound(): NotFoundException {
  return new NotFoundException({ code: 'PROVIDER_SYNC_JOB_NOT_FOUND', message: 'Provider sync job was not found.' });
}

function parseMode(value: string | undefined): ProviderSyncMode {
  const mode = value ?? 'incremental';
  if (mode === 'initial_backfill' || mode === 'incremental' || mode === 'webhook_refresh') return mode;
  throw new BadRequestException({ code: 'INVALID_PROVIDER_SYNC_MODE', message: 'Provider sync mode is invalid.' });
}

function parseGrantedScopes(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((scope) => scope.trim().toLowerCase()).filter(Boolean))].sort();
}

function optionalTimestamp(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException({ code: 'INVALID_PROVIDER_SYNC_RANGE', message: `${field} must be an ISO timestamp.`, field });
  }
  return date;
}

function requiredText(value: string | undefined, maximum: number, field: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximum) {
    throw new BadRequestException({ code: 'INVALID_PROVIDER_CALLBACK', message: `Provider callback ${field} is invalid.` });
  }
  return normalized;
}

function safeReturnTo(value: string): string {
  const normalized = value.trim();
  return normalized.startsWith('/') && !normalized.startsWith('//') && !normalized.includes('\\') && normalized.length <= 1000
    ? normalized
    : '/';
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException({ code: 'PROVIDER_NOT_CONFIGURED', message: 'Provider integration is not configured.' });
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid provider timestamp.');
  return date.toISOString();
}

function toIsoOrNull(value: unknown | null): string | null {
  return value === null ? null : toIso(value);
}
