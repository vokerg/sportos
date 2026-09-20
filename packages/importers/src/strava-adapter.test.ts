import { describe, expect, it } from 'vitest';
import type { HttpRequest, HttpResponse, ProviderHttpTransport } from './provider-types.js';
import { StravaAdapter, canonicalActivityType, stravaActivityFingerprint } from './strava-adapter.js';

class FakeTransport implements ProviderHttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly responses: HttpResponse[]) {}
  async request(input: HttpRequest): Promise<HttpResponse> {
    this.requests.push(input);
    const response = this.responses.shift();
    if (!response) throw new Error('No fake response.');
    return response;
  }
}

const authorization = {
  providerAccountId: '42',
  displayName: 'Athlete',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: new Date('2026-08-04T12:00:00Z'),
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
  it('builds OAuth and parses the initial athlete authorization', async () => {
    const transport = new FakeTransport([{ status: 200, headers: {}, body: {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_at: 1_800_000_000,
      athlete: { id: 42, firstname: 'Test', lastname: 'Athlete' },
    } }]);
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, transport);
    const url = adapter.createAuthorizationUrl({
      state: 'state',
      redirectUri: 'https://sportos.example/providers/strava/callback',
      scopes: ['read', 'activity:read_all'],
    });
    expect(url.searchParams.get('scope')).toBe('activity:read_all,read');
    expect(await adapter.exchangeAuthorizationCode({
      code: 'code',
      redirectUri: 'https://sportos.example/providers/strava/callback',
    })).toMatchObject({ providerAccountId: '42', accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('rotates refresh tokens when Strava omits the athlete object', async () => {
    const transport = new FakeTransport([{ status: 200, headers: {}, body: {
      access_token: 'rotated-access',
      refresh_token: 'rotated-refresh',
      expires_at: 1_800_000_100,
    } }]);
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, transport);
    await expect(adapter.refreshAuthorization(authorization)).resolves.toMatchObject({
      providerAccountId: '42',
      displayName: 'Athlete',
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
      scopes: ['activity:read_all'],
    });
    expect(transport.requests[0]?.body).toContain('grant_type=refresh_token');
  });

  it('parses activity pages, rate limits, and stable provider identity', async () => {
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, new FakeTransport([{ status: 200, headers: {
      'x-ratelimit-limit': '100,1000',
      'x-ratelimit-usage': '10,100',
    }, body: [activity] }]));
    const page = await adapter.fetchActivityPage({ authorization, page: 1, perPage: 200 });
    const parsed = page.activities[0]!;
    expect(parsed.providerActivityId).toBe('123456789');
    expect(canonicalActivityType(parsed)).toBe('run');
    expect(stravaActivityFingerprint(parsed)).toMatch(/^[0-9a-f]{64}$/);
    expect(stravaActivityFingerprint({ ...parsed, distanceM: 9999, movingTimeS: 3000 })).toBe(stravaActivityFingerprint(parsed));
    expect(stravaActivityFingerprint({ ...parsed, providerActivityId: 'different' })).not.toBe(stravaActivityFingerprint(parsed));
    expect(page.rateLimit).toMatchObject({ shortLimit: 100, dailyLimit: 1000 });
  });

  it('fetches detailed activity, all supported streams, laps, and zones', async () => {
    const transport = new FakeTransport([
      { status: 200, headers: {}, body: { ...activity, description: 'Long run', segment_efforts: [] } },
      { status: 200, headers: {}, body: { time: { data: [0, 1] }, latlng: { data: [[55.7, 12.4], [55.7, 12.5]] } } },
      { status: 200, headers: {}, body: [{ id: 1, name: 'Lap 1' }] },
      { status: 200, headers: {}, body: [{ type: 'heartrate', distribution_buckets: [] }] },
    ]);
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, transport);
    const bundle = await adapter.fetchActivityDetailBundle({ authorization, providerActivityId: '123456789' });
    expect(bundle?.resources.map((resource) => resource.resourceType)).toEqual(['detail', 'streams', 'laps', 'zones']);
    expect(bundle?.resources.every((resource) => resource.availability === 'available')).toBe(true);
    expect(transport.requests[0]?.url.searchParams.get('include_all_efforts')).toBe('true');
    const keys = transport.requests[1]?.url.searchParams.get('keys')?.split(',') ?? [];
    expect(keys).toEqual(expect.arrayContaining(['time', 'distance', 'latlng', 'heartrate', 'cadence', 'watts', 'altitude', 'moving']));
    expect(transport.requests[1]?.url.searchParams.get('key_by_type')).toBe('true');
    expect(transport.requests[0]?.maxResponseBytes).toBeUndefined();
    expect(transport.requests[1]?.maxResponseBytes).toBe(20 * 1024 * 1024);
  });

  it('keeps subscription-gated zones as an unavailable cached resource', async () => {
    const transport = new FakeTransport([
      { status: 200, headers: {}, body: activity },
      { status: 200, headers: {}, body: {} },
      { status: 200, headers: {}, body: [] },
      { status: 403, headers: {}, body: { message: 'Forbidden' } },
    ]);
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, transport);
    const bundle = await adapter.fetchActivityDetailBundle({ authorization, providerActivityId: '123456789' });
    expect(bundle?.resources.find((resource) => resource.resourceType === 'zones')).toEqual({
      resourceType: 'zones', availability: 'unavailable', httpStatus: 403, payload: null,
    });
  });

  it('classifies rate limits', async () => {
    const adapter = new StravaAdapter({ clientId: 'client', clientSecret: 'secret' }, new FakeTransport([{ status: 429, headers: {
      'x-ratelimit-limit': '100,1000',
      'x-ratelimit-usage': '100,100',
    }, body: {} }]));
    await expect(adapter.fetchActivityPage({ authorization, page: 1, perPage: 200 })).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
      retryable: true,
    });
  });
});
