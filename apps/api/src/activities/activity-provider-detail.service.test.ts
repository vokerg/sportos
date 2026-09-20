import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActivityProviderResourcesRepository,
  ProvidersRepository,
  type Database,
  type Kysely,
} from '@sportos/db';
import { CredentialCipher, ProviderError, StravaAdapter } from '@sportos/importers';
import type { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { ActivityProviderDetailService } from './activity-provider-detail.service.js';

const activityId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const connectionId = '33333333-3333-4333-8333-333333333333';
const providerVersion = 'a'.repeat(64);
const reference = {
  activityId, provider: 'strava' as const, providerActivityId: '20223486250', connectionId, providerVersion,
};
const cached = ['detail', 'streams', 'laps', 'zones'].map((resourceType) => ({
  resourceType: resourceType as 'detail' | 'streams' | 'laps' | 'zones',
  availability: 'available' as const,
  httpStatus: 200,
  providerVersion,
  fetchedAt: new Date('2026-09-20T08:00:00Z'),
  payload: { resourceType },
}));

describe('ActivityProviderDetailService', () => {
  beforeEach(() => {
    process.env.STRAVA_CLIENT_ID = 'client';
    process.env.STRAVA_CLIENT_SECRET = 'secret';
    process.env.SPORTOS_PROVIDER_ACTIVE_KEY_ID = 'test';
    process.env.SPORTOS_PROVIDER_CREDENTIAL_KEYS = `test:${Buffer.alloc(32, 7).toString('base64')}`;
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns a complete current cache without calling Strava', async () => {
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'getProviderReference').mockResolvedValue(reference);
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'list').mockResolvedValue(cached);
    const providerFetch = vi.spyOn(StravaAdapter.prototype, 'fetchActivityDetailBundle');
    const service = new ActivityProviderDetailService(dbProvider(), activityDetailDbProvider());
    await expect(service.load(accountId, activityId)).resolves.toMatchObject({
      provider: 'strava', providerActivityId: '20223486250', cacheStatus: 'hit',
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('fetches and stores all resources when the cache is missing', async () => {
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'getProviderReference').mockResolvedValue(reference);
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'list').mockResolvedValueOnce([]).mockResolvedValueOnce(cached);
    const replace = vi.spyOn(ActivityProviderResourcesRepository.prototype, 'replace').mockResolvedValue();
    mockAuthorization();
    vi.spyOn(StravaAdapter.prototype, 'fetchActivityDetailBundle').mockResolvedValue(bundle());
    const service = new ActivityProviderDetailService(dbProvider(), activityDetailDbProvider());

    await expect(service.load(accountId, activityId)).resolves.toMatchObject({ cacheStatus: 'miss' });
    expect(replace).toHaveBeenCalledWith(reference, expect.arrayContaining([
      expect.objectContaining({ resourceType: 'streams' }),
      expect.objectContaining({ resourceType: 'zones', availability: 'unavailable', httpStatus: 403 }),
    ]));
  });

  it('refetches when the retained Strava summary hash changes', async () => {
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'getProviderReference').mockResolvedValue(reference);
    const stale = cached.map((resource) => ({ ...resource, providerVersion: 'b'.repeat(64) }));
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'list').mockResolvedValueOnce(stale).mockResolvedValueOnce(cached);
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'replace').mockResolvedValue();
    mockAuthorization();
    const providerFetch = vi.spyOn(StravaAdapter.prototype, 'fetchActivityDetailBundle').mockResolvedValue(bundle());
    const service = new ActivityProviderDetailService(dbProvider(), activityDetailDbProvider());

    await expect(service.load(accountId, activityId)).resolves.toMatchObject({ cacheStatus: 'miss' });
    expect(providerFetch).toHaveBeenCalledWith(expect.objectContaining({ providerActivityId: '20223486250' }));
  });

  it('persists reauthorization-required state when Strava rejects the detail request', async () => {
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'getProviderReference').mockResolvedValue(reference);
    vi.spyOn(ActivityProviderResourcesRepository.prototype, 'list').mockResolvedValue([]);
    mockAuthorization();
    vi.spyOn(StravaAdapter.prototype, 'fetchActivityDetailBundle').mockRejectedValue(
      new ProviderError('PROVIDER_REAUTHORIZATION_REQUIRED', 'Strava rejected the token.', false),
    );
    const mark = vi.spyOn(ProvidersRepository.prototype, 'markReauthorizationRequired').mockResolvedValue();
    const service = new ActivityProviderDetailService(dbProvider(), activityDetailDbProvider());

    await expect(service.load(accountId, activityId)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PROVIDER_REAUTHORIZATION_REQUIRED' }),
    });
    expect(mark).toHaveBeenCalledWith(connectionId, 'PROVIDER_REAUTHORIZATION_REQUIRED', 'Strava rejected the token.');
  });
});

function mockAuthorization(): void {
  vi.spyOn(ProvidersRepository.prototype, 'loadWorkerAuthorization').mockResolvedValue({
    connection: { id: connectionId } as never,
    credential: {
      key_id: 'test', algorithm: 'aes-256-gcm', nonce: 'nonce', ciphertext: 'ciphertext',
      authentication_tag: 'tag', envelope_version: 1,
    } as never,
  });
  vi.spyOn(CredentialCipher.prototype, 'decrypt').mockReturnValue({
    providerAccountId: '42', displayName: 'Athlete', accessToken: 'access', refreshToken: 'refresh',
    expiresAt: new Date('2099-01-01T00:00:00Z'), scopes: ['activity:read_all'],
  });
}

function bundle() {
  return {
    providerActivityId: '20223486250',
    resources: [
      { resourceType: 'detail' as const, availability: 'available' as const, httpStatus: 200, payload: { id: 20223486250 } },
      { resourceType: 'streams' as const, availability: 'available' as const, httpStatus: 200, payload: { time: { data: [0, 1] } } },
      { resourceType: 'laps' as const, availability: 'available' as const, httpStatus: 200, payload: [] },
      { resourceType: 'zones' as const, availability: 'unavailable' as const, httpStatus: 403, payload: null },
    ],
  };
}

function dbProvider(): DbProvider {
  const scopedDb = {} as Kysely<Database>;
  return {
    withAccount: vi.fn(async <T>(_accountId: string, callback: (db: Kysely<Database>) => Promise<T>) => callback(scopedDb)),
  } as unknown as DbProvider;
}

function activityDetailDbProvider(): ActivityDetailDbProvider {
  const scopedDb = {} as Kysely<Database>;
  return {
    withAccount: vi.fn(async <T>(_accountId: string, callback: (db: Kysely<Database>) => Promise<T>) => callback(scopedDb)),
  } as unknown as ActivityDetailDbProvider;
}
