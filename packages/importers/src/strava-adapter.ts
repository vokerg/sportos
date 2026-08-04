import { createHash } from 'node:crypto';
import type {
  ActivityPage, ActivityPageRequest, ActivityRequest, AuthorizationCodeExchange, AuthorizationRequest,
  HttpRequest, HttpResponse, ProviderActivity, ProviderAdapter, ProviderAuthorization,
  ProviderHttpTransport, ProviderRateLimit,
} from './provider-types.js';
import { ProviderError } from './provider-types.js';

const MAX_PROVIDER_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface StravaAdapterConfig {
  clientId: string;
  clientSecret: string;
  authorizationBaseUrl?: string;
  apiBaseUrl?: string;
}

export class StravaAdapter implements ProviderAdapter {
  readonly provider = 'strava' as const;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly authorizationBaseUrl: URL;
  private readonly apiBaseUrl: URL;

  constructor(config: StravaAdapterConfig, private readonly transport: ProviderHttpTransport = new FetchProviderTransport()) {
    this.clientId = requiredText(config.clientId, 200, 'Strava client id');
    this.clientSecret = requiredText(config.clientSecret, 1000, 'Strava client secret');
    this.authorizationBaseUrl = normalizedBase(config.authorizationBaseUrl ?? 'https://www.strava.com');
    this.apiBaseUrl = normalizedBase(config.apiBaseUrl ?? 'https://www.strava.com');
  }

  createAuthorizationUrl(input: AuthorizationRequest): URL {
    const url = new URL('/oauth/authorize', this.authorizationBaseUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', secureUrl(input.redirectUri).toString());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('approval_prompt', 'auto');
    url.searchParams.set('scope', scopes(input.scopes).join(','));
    url.searchParams.set('state', requiredText(input.state, 500, 'OAuth state'));
    return url;
  }

  async exchangeAuthorizationCode(input: AuthorizationCodeExchange): Promise<ProviderAuthorization> {
    return this.tokenRequest({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: requiredText(input.code, 2000, 'authorization code'),
      grant_type: 'authorization_code',
      redirect_uri: secureUrl(input.redirectUri).toString(),
    });
  }

  refreshAuthorization(input: ProviderAuthorization): Promise<ProviderAuthorization> {
    return this.tokenRequest({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: requiredText(input.refreshToken, 10_000, 'refresh token'),
      grant_type: 'refresh_token',
    }, input);
  }

  async revokeAuthorization(input: ProviderAuthorization): Promise<void> {
    const response = await this.transport.request({
      method: 'POST',
      url: new URL('/oauth/deauthorize', this.authorizationBaseUrl),
      headers: { authorization: `Bearer ${requiredText(input.accessToken, 10_000, 'access token')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: input.accessToken }).toString(),
    });
    if ([200, 401, 404].includes(response.status)) return;
    throw responseError(response, 'Strava authorization could not be revoked.');
  }

  async fetchActivityPage(input: ActivityPageRequest): Promise<ActivityPage> {
    const url = new URL('/api/v3/athlete/activities', this.apiBaseUrl);
    url.searchParams.set('page', String(integer(input.page, 1, 100_000, 'page')));
    url.searchParams.set('per_page', String(integer(input.perPage, 1, 200, 'per page')));
    if (input.after) url.searchParams.set('after', String(epoch(input.after)));
    if (input.before) url.searchParams.set('before', String(epoch(input.before)));
    const response = await this.authorizedGet(url, input.authorization);
    if (!Array.isArray(response.body)) throw new ProviderError('PROVIDER_RESPONSE_INVALID', 'Strava returned an invalid activity page.', false);
    const rawActivities = response.body.map((item) => record(item, 'activity'));
    return { activities: rawActivities.map(parseActivity), rawActivities, rateLimit: rateLimit(response.headers, response.status) };
  }

  async fetchActivity(input: ActivityRequest): Promise<ProviderActivity | null> {
    const response = await this.transport.request({
      method: 'GET',
      url: new URL(`/api/v3/activities/${encodeURIComponent(providerId(input.providerActivityId, 'activity id'))}`, this.apiBaseUrl),
      headers: { authorization: `Bearer ${requiredText(input.authorization.accessToken, 10_000, 'access token')}` },
    });
    if (response.status === 404) return null;
    success(response, 'Strava activity could not be loaded.');
    return parseActivity(record(response.body, 'activity'));
  }

  private async authorizedGet(url: URL, authorization: ProviderAuthorization): Promise<HttpResponse> {
    const response = await this.transport.request({ method: 'GET', url, headers: { authorization: `Bearer ${requiredText(authorization.accessToken, 10_000, 'access token')}` } });
    success(response, 'Strava activities could not be loaded.');
    return response;
  }

  private async tokenRequest(fields: Record<string, string>, fallback?: ProviderAuthorization): Promise<ProviderAuthorization> {
    const response = await this.transport.request({
      method: 'POST',
      url: new URL('/oauth/token', this.authorizationBaseUrl),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    success(response, 'Strava authorization failed.');
    const body = record(response.body, 'authorization response');
    const athlete = optionalRecord(body.athlete);
    if (!athlete && !fallback) {
      throw new ProviderError('PROVIDER_RESPONSE_INVALID', 'Strava authorization response did not include an athlete.', false);
    }
    const returnedScopes = parseScopes(body.scope);
    return {
      providerAccountId: athlete ? providerId(athlete.id, 'athlete id') : fallback!.providerAccountId,
      displayName: athlete ? athleteName(athlete) : fallback!.displayName,
      accessToken: requiredText(body.access_token, 10_000, 'access token'),
      refreshToken: requiredText(body.refresh_token, 10_000, 'refresh token'),
      expiresAt: new Date(finite(body.expires_at, 'expires_at') * 1000),
      scopes: returnedScopes.length > 0 ? returnedScopes : (fallback?.scopes ?? []),
    };
  }
}

export class FetchProviderTransport implements ProviderHttpTransport {
  async request(input: HttpRequest): Promise<HttpResponse> {
    let response: Response;
    try {
      response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ProviderError('PROVIDER_UNAVAILABLE', 'The provider could not be reached.', true);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new ProviderError('PROVIDER_RESPONSE_INVALID', 'The provider response exceeded the configured size limit.', false, null, response.status);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new ProviderError('PROVIDER_RESPONSE_INVALID', 'The provider response exceeded the configured size limit.', false, null, response.status);
    }
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text) as unknown; }
      catch { body = text.slice(0, 500); }
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
    return { status: response.status, headers, body };
  }
}

export function stravaActivityFingerprint(activity: ProviderActivity): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    type: canonicalActivityType(activity),
    startDate: activity.startDate.toISOString(),
    distanceM: rounded(activity.distanceM),
    movingTimeS: rounded(activity.movingTimeS ?? activity.elapsedTimeS),
  })).digest('hex');
}

export function canonicalActivityType(activity: ProviderActivity): 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | null {
  const value = (activity.sportType ?? activity.type).replace(/[^A-Za-z]/g, '').toLowerCase();
  if (['run', 'trailrun', 'virtualrun', 'wheelchair'].includes(value)) return 'run';
  if (['ride', 'mountainbikeride', 'gravelride', 'virtualride', 'ebikeride', 'velomobile'].includes(value)) return 'bike';
  if (value === 'swim') return 'swim';
  if (['rowing', 'virtualrowing'].includes(value)) return 'rowing';
  if (['standuppaddling', 'sup'].includes(value)) return 'sup';
  if (['workout', 'weighttraining', 'crossfit', 'elliptical', 'stairmapper', 'yoga', 'pilates'].includes(value)) return 'workout';
  return null;
}

function parseActivity(raw: Record<string, unknown>): ProviderActivity {
  const startDate = date(raw.start_date, 'activity start date');
  const localDate = typeof raw.start_date_local === 'string' ? raw.start_date_local.slice(0, 10) : startDate.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new ProviderError('PROVIDER_RESPONSE_INVALID', 'Strava returned an invalid local activity date.', false);
  return {
    providerActivityId: providerId(raw.id, 'activity id'),
    providerUpdatedAt: optionalDate(raw.updated_at),
    name: optionalText(raw.name, 500),
    type: requiredText(raw.type, 100, 'activity type'),
    sportType: optionalText(raw.sport_type, 100),
    startDate,
    localDate,
    timezone: optionalText(raw.timezone, 200),
    distanceM: nonNegative(raw.distance, 'distance'),
    elapsedTimeS: nonNegative(raw.elapsed_time, 'elapsed time'),
    movingTimeS: nonNegative(raw.moving_time, 'moving time'),
    elevationGainM: nonNegative(raw.total_elevation_gain, 'elevation gain'),
    averageHeartrate: nonNegative(raw.average_heartrate, 'average heart rate'),
    maxHeartrate: nonNegative(raw.max_heartrate, 'maximum heart rate'),
    averageSpeedMps: nonNegative(raw.average_speed, 'average speed'),
    calories: nonNegative(raw.calories, 'calories'),
    isManual: raw.manual === true,
    isIndoor: raw.trainer === true || raw.indoor === true,
    isPrivate: raw.private === true,
    isRace: raw.workout_type === 1,
    raw,
  };
}

function success(response: HttpResponse, message: string): void {
  if (response.status < 200 || response.status >= 300) throw responseError(response, message);
}
function responseError(response: HttpResponse, message: string): ProviderError {
  if (response.status === 401 || response.status === 403) return new ProviderError('PROVIDER_REAUTHORIZATION_REQUIRED', message, false, null, response.status);
  const limits = rateLimit(response.headers, response.status);
  if (response.status === 429) return new ProviderError('PROVIDER_RATE_LIMITED', 'The provider rate limit was reached.', true, limits.retryAt, response.status);
  if (response.status >= 500) return new ProviderError('PROVIDER_UNAVAILABLE', message, true, null, response.status);
  return new ProviderError('PROVIDER_AUTHORIZATION_FAILED', message, false, null, response.status);
}
function rateLimit(headers: Record<string, string>, status: number): ProviderRateLimit {
  const limit = pair(headers['x-ratelimit-limit'] ?? headers['x-readratelimit-limit']);
  const usage = pair(headers['x-ratelimit-usage'] ?? headers['x-readratelimit-usage']);
  const daily = limit[1] !== null && usage[1] !== null && usage[1] >= limit[1];
  const short = limit[0] !== null && usage[0] !== null && usage[0] >= limit[0];
  return { shortLimit: limit[0], shortUsage: usage[0], dailyLimit: limit[1], dailyUsage: usage[1], retryAt: status === 429 || short || daily ? (daily ? nextMidnight() : nextQuarter()) : null };
}
function pair(value?: string): [number | null, number | null] { const values = value?.split(',').map(Number) ?? []; return [safeInt(values[0]), safeInt(values[1])]; }
function nextQuarter(): Date { const value = new Date(); value.setUTCSeconds(0, 0); value.setUTCMinutes(Math.floor(value.getUTCMinutes() / 15) * 15 + 15); return value; }
function nextMidnight(): Date { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)); }
function parseScopes(value: unknown): string[] { if (Array.isArray(value)) return scopes(value.filter((item): item is string => typeof item === 'string')); if (typeof value === 'string') return scopes(value.split(',')); return []; }
function scopes(values: string[]): string[] { const result = [...new Set(values.map((value) => requiredText(value, 100, 'scope').toLowerCase()))].sort(); if (!result.length) throw new ProviderError('PROVIDER_SCOPE_MISSING', 'At least one provider scope is required.', false); return result; }
function athleteName(value: Record<string, unknown>): string | null { return [optionalText(value.firstname, 100), optionalText(value.lastname, 100)].filter(Boolean).join(' ').trim() || optionalText(value.username, 200); }
function providerId(value: unknown, name: string): string { if (typeof value === 'string') return requiredText(value, 200, name); if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value); throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false); }
function optionalRecord(value: unknown): Record<string, unknown> | null { return value === undefined || value === null ? null : record(value, 'athlete'); }
function record(value: unknown, name: string): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Strava returned an invalid ${name}.`, false); return value as Record<string, unknown>; }
function requiredText(value: unknown, maximum: number, name: string): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false); return value.trim(); }
function optionalText(value: unknown, maximum: number): string | null { return value === null || value === undefined || value === '' ? null : requiredText(value, maximum, 'provider text'); }
function finite(value: unknown, name: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false); return value; }
function nonNegative(value: unknown, name: string): number | null { if (value === null || value === undefined) return null; const result = finite(value, name); if (result < 0) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false); return result; }
function integer(value: number, minimum: number, maximum: number, name: string): number { if (!Number.isInteger(value) || value < minimum || value > maximum) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false); return value; }
function date(value: unknown, name: string): Date { const result = value instanceof Date ? new Date(value) : new Date(typeof value === 'string' ? value : Number.NaN); if (!Number.isFinite(result.getTime())) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false); return result; }
function optionalDate(value: unknown): Date | null { return value === null || value === undefined || value === '' ? null : date(value, 'provider update date'); }
function epoch(value: Date): number { return Math.floor(date(value, 'cursor date').getTime() / 1000); }
function safeInt(value?: number): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function rounded(value: number | null): number | null { return value === null || !Number.isFinite(value) ? null : Math.round(value); }
function secureUrl(value: string): URL { const url = new URL(value); if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new ProviderError('PROVIDER_CONFIGURATION_ERROR', 'Provider URL must use HTTPS.', false); return url; }
function normalizedBase(value: string): URL { const url = secureUrl(value); url.pathname = url.pathname.replace(/\/$/, ''); url.search = ''; url.hash = ''; return url; }
