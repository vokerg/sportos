import { describe, expect, it } from 'vitest';
import { ProviderError, type HttpRequest, type HttpResponse, type ProviderHttpTransport } from './provider-types.js';
import { StravaAdapter, canonicalActivityType, stravaActivityFingerprint } from './strava-adapter.js';

class FakeTransport implements ProviderHttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: HttpResponse[]) {}
  async request(input: HttpRequest): Promise<HttpResponse> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('No fake response configured.');
    return response;
  }
}

const authorization = {
  providerAccountId: '42',
  displayName: 'Athlete',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: new Date('2026-08-04T12:00:00.000Z'),
  scopes: ['activity:read_all'],
};

const activity = {
  id: 123456789,
  name: 'Morning Run',
  type: 'Run',
  sport_type: 'TrailRun',
  start_date: '2026-08-03T06:00:00Z',
  start_date_local: '2026-08-03T08:00:00',
  timezone: '(GMT+02:00) Europe/Copenhagen',
  distance: 10000,
  elapsed_time: 3600,
  moving_time: 3500,
  total_elevation_gain: 125,
  average_heartrate: 145,
  max_heartrate: 171,
  average_speed: 2.857,
  manual: false,
  trainer: false,
  private: false,
  workout_type: 1,
};

describe('StravaAdapter', () => {
  it('builds bounded OAuth requests and parses token rotation', async () => {
    const transport = new FakeTransport([{ status: 200, headers: {}, body: {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: 1_800_000_000,
      athlete: { id: 42, firstname: 'Test', lastname: 'Athlete' },
    } }]);
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, transport);
    const url = adapter.createAuthorizationUrl({
      state: 'state-value',
      redirectUri: 'https://sportos.example/providers/strava/callback',
      scopes: ['read', 'activity:read_all'],
    });
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('scope')).toBe('activity:read_all,read');

    const result = await adapter.exchangeAuthorizationCode({
      code: 'one-time-code',
      redirectUri: 'https://sportos.example/providers/strava/callback',
    });
    expect(result).toMatchObject({ providerAccountId: '42', accessToken: 'new-access', refreshToken: 'new-refresh' });
    expect(transport.requests[0]?.body).not.toContain('undefined');
  });

  it('parses activity pages and rate-limit headers without guessing unsupported types', async () => {
    const transport = new FakeTransport([{ status: 200, headers: {
      'x-ratelimit-limit': '100,1000',
      'x-ratelimit-usage': '10,100',
    }, body: [activity] }]);
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, transport);
    const page = await adapter.fetchActivityPage({ authorization, page: 1, perPage: 200 });
    expect(page.activities).toHaveLength(1);
    expect(page.activities[0]?.providerActivityId).toBe('123456789');
    expect(page.activities[0] && canonicalActivityType(page.activities[0])).toBe('run');
    expect(page.activities[0] && stravaActivityFingerprint(page.activities[0])).toMatch(/^[0-9a-f]{64}$/);
    expect(page.rateLimit).toMatchObject({ shortLimit: 100, shortUsage: 10, dailyLimit: 1000, dailyUsage: 100 });
  });

  it('classifies rate limits and authorization failures without leaking provider bodies', async () => {
    const rateTransport = new FakeTransport([{ status: 429, headers: {
      'x-ratelimit-limit': '100,1000',
      'x-ratelimit-usage': '100,100',
    }, body: { message: 'contains provider internals' } }]);
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, rateTransport);
    await expect(adapter.fetchActivityPage({ authorization, page: 1, perPage: 200 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
    } satisfies Partial<ProviderError>);

    const authTransport = new FakeTransport([{ status: 401, headers: {}, body: { token: 'secret' } }]);
    const authAdapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, authTransport);
    await expect(authAdapter.fetchActivityPage({ authorization, page: 1, perPage: 200 })).rejects.toMatchObject({
      code: 'PROVIDER_REAUTHORIZATION_REQUIRED',
      retryable: false,
    } satisfies Partial<ProviderError>);
  });
});
