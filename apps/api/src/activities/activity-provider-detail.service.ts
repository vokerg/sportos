import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  ACTIVITY_PROVIDER_RESOURCE_TYPES,
  ActivityProviderResourcesRepository,
  ProvidersRepository,
  type ActivityProviderReference,
  type ActivityProviderResourceReadModel,
  type ActivityProviderResourceWrite,
  type Json,
} from '@sportos/db';
import {
  CredentialCipher,
  ProviderError,
  StravaAdapter,
  parseCredentialKeyRing,
  type ProviderAuthorization,
} from '@sportos/importers';
import { DbProvider } from '../db.provider.js';

export interface ActivityProviderDetailResponse {
  provider: 'strava';
  providerActivityId: string;
  fetchedAt: string;
  cacheStatus: 'hit' | 'miss';
  resources: Record<string, {
    availability: 'available' | 'unavailable';
    httpStatus: number | null;
    payload: Json;
  }>;
}

@Injectable()
export class ActivityProviderDetailService {
  constructor(private readonly dbProvider: DbProvider) {}

  async load(accountId: string, activityId: string): Promise<ActivityProviderDetailResponse> {
    const reference = await this.dbProvider.withAccount(accountId, (db) =>
      new ActivityProviderResourcesRepository(db).getProviderReference(activityId));
    if (!reference) throw activityNotFound();

    const cached = await this.dbProvider.withAccount(accountId, (db) =>
      new ActivityProviderResourcesRepository(db).list(activityId, reference.provider));
    if (isCompleteAndCurrent(cached, reference.providerUpdatedAt)) {
      return response(reference, cached, 'hit');
    }

    let authorization = await this.loadAuthorization(accountId, reference);
    const adapter = this.stravaAdapter();
    if (authorization.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000) {
      try {
        authorization = await adapter.refreshAuthorization(authorization);
      } catch (error) {
        throw providerFailure(error);
      }
      const envelope = this.credentialCipher().encrypt(reference.connectionId, accountId, reference.provider, authorization);
      await this.dbProvider.withAccount(accountId, (db) =>
        new ProvidersRepository(db).replaceCredential(reference.connectionId, envelope, authorization.expiresAt));
    }

    let bundle;
    try {
      bundle = await adapter.fetchActivityDetailBundle({
        authorization,
        providerActivityId: reference.providerActivityId,
      });
    } catch (error) {
      throw providerFailure(error);
    }
    if (!bundle) throw activityNotFound();

    const writes: ActivityProviderResourceWrite[] = bundle.resources.map((resource) => ({
      resourceType: resource.resourceType,
      availability: resource.availability,
      httpStatus: resource.httpStatus,
      payload: asJson(resource.payload),
    }));
    await this.dbProvider.withAccount(accountId, (db) =>
      new ActivityProviderResourcesRepository(db).replace(reference, writes));
    const stored = await this.dbProvider.withAccount(accountId, (db) =>
      new ActivityProviderResourcesRepository(db).list(activityId, reference.provider));
    return response(reference, stored, 'miss');
  }

  private async loadAuthorization(accountId: string, reference: ActivityProviderReference): Promise<ProviderAuthorization> {
    const stored = await this.dbProvider.withAccount(accountId, (db) =>
      new ProvidersRepository(db).loadWorkerAuthorization(reference.connectionId));
    if (!stored) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_REAUTHORIZATION_REQUIRED',
        message: 'Strava authorization is unavailable for this activity.',
      });
    }
    try {
      return this.credentialCipher().decrypt(reference.connectionId, accountId, reference.provider, {
        keyId: stored.credential.key_id,
        algorithm: stored.credential.algorithm,
        nonce: stored.credential.nonce,
        ciphertext: stored.credential.ciphertext,
        authenticationTag: stored.credential.authentication_tag,
        envelopeVersion: stored.credential.envelope_version,
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_REAUTHORIZATION_REQUIRED',
        message: 'Strava authorization could not be loaded for this activity.',
      });
    }
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
}

function isCompleteAndCurrent(resources: ActivityProviderResourceReadModel[], providerUpdatedAt: Date | null): boolean {
  if (resources.length !== ACTIVITY_PROVIDER_RESOURCE_TYPES.length) return false;
  const types = new Set(resources.map((resource) => resource.resourceType));
  if (!ACTIVITY_PROVIDER_RESOURCE_TYPES.every((type) => types.has(type))) return false;
  return resources.every((resource) => sameTimestamp(resource.providerUpdatedAt, providerUpdatedAt));
}

function response(
  reference: ActivityProviderReference,
  resources: ActivityProviderResourceReadModel[],
  cacheStatus: 'hit' | 'miss',
): ActivityProviderDetailResponse {
  if (resources.length === 0) throw new ServiceUnavailableException({
    code: 'ACTIVITY_PROVIDER_DETAIL_UNAVAILABLE',
    message: 'Provider activity detail could not be cached.',
  });
  const fetchedAt = resources.reduce((latest, resource) =>
    resource.fetchedAt > latest ? resource.fetchedAt : latest, resources[0]!.fetchedAt);
  return {
    provider: reference.provider,
    providerActivityId: reference.providerActivityId,
    fetchedAt: fetchedAt.toISOString(),
    cacheStatus,
    resources: Object.fromEntries(resources.map((resource) => [resource.resourceType, {
      availability: resource.availability,
      httpStatus: resource.httpStatus,
      payload: resource.payload,
    }])),
  };
}

function sameTimestamp(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

function asJson(value: unknown): Json {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}

function providerFailure(error: unknown): ServiceUnavailableException {
  if (error instanceof ProviderError) {
    return new ServiceUnavailableException({
      code: error.code,
      message: error.message,
      retryAt: error.retryAt?.toISOString() ?? null,
    });
  }
  return new ServiceUnavailableException({
    code: 'ACTIVITY_PROVIDER_DETAIL_UNAVAILABLE',
    message: 'Provider activity detail could not be loaded.',
  });
}

function activityNotFound(): NotFoundException {
  return new NotFoundException({ code: 'ACTIVITY_NOT_FOUND', message: 'Activity was not found.' });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException({
    code: 'PROVIDER_NOT_CONFIGURED',
    message: 'Provider integration is not configured.',
  });
  return value;
}
