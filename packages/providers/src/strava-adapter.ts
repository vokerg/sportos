import { createHash } from 'node:crypto';
import type {
  ActivityPage,
  ActivityPageRequest,
  ActivityRequest,
  AuthorizationCodeExchange,
  AuthorizationRequest,
  HttpRequest,
  HttpResponse,
  ProviderActivity,
  ProviderAdapter,
  ProviderAuthorization,
  ProviderHttpTransport,
  ProviderRateLimit,
} from './provider-types.js';
import { ProviderError } from './provider-types.js';

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
    this.clientId = requireText(config.clientId, 200, 'Strava client id');
    this.clientSecret = requireText(config.clientSecret, 1000, 'Strava client secret');
    this.authorizationBaseUrl = baseUrl(config.authorizationBaseUrl ?? 'https://www.strava.com');
    this.apiBaseUrl = baseUrl(config.apiBaseUrl ?? 'https://www.strava.com');
  }

  createAuthorizationUrl(input: AuthorizationRequest): URL {
    const url = new URL('/oauth/authorize', this.authorizationBaseUrl);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', validUrl(input.redirectUri).toString());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('approval_prompt', 'auto');
    url.searchParams.set('scope', normalizedScopes(input.scopes).join(','));
    url.searchParams.set('state', requireText(input.state, 500, 'OAuth state'));
    return url;
  }

  async exchangeAuthorizationCode(input: AuthorizationCodeExchange): Promise<ProviderAuthorization> {
    return this.tokenRequest(new URL('/oauth/token', this.authorizationBaseUrl), {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: requireText(input.code, 2000, 'authorization code'),
      grant_type: 'authorization_code',
      redirect_uri: validUrl(input.redirectUri).toString(),
    });
  }

  async refreshAuthorization(input: ProviderAuthorization): Promise<ProviderAuthorization> {
    const refreshed = await this.tokenRequest(new URL('/oauth/token', this.authorizationBaseUrl), {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: requireText(input.refreshToken, 10_000, 'refresh token'),
      grant_type: 'refresh_token',
    });
    return {
      ...refreshed,
      providerAccountId: input.providerAccountId,
      displayName: refreshed.displayName ?? input.displayName,
      scopes: input.scopes,
    };
  }

  async revokeAuthorization(input: ProviderAuthorization): Promise<void> {
    const response = await this.transport.request({
      method: 'POST',
      url: new URL('/oauth/deauthorize', this.authorizationBaseUrl),
      headers: {
        authorization: `Bearer ${requireText(input.accessToken, 10_000, 'access token')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ access_token: input.accessToken }).toString(),
    });
    if (response.status === 200 || response.status === 401 || response.status === 404) return;
    throw providerResponseError(response, 'Strava authorization could not be revoked.');
  }

  async fetchActivityPage(input: ActivityPageRequest): Promise<ActivityPage> {
    const page = boundedInteger(input.page, 1, 100_000, 'page');
    const perPage = boundedInteger(input.perPage, 1, 200, 'per page');
    const url = new URL('/api/v3/athlete/activities', this.apiBaseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    if (input.after) url.searchParams.set('after', String(unixSeconds(input.after)));
    if (input.before) url.searchParams.set('before', String(unixSeconds(input.before)));
    const response = await this.authorizedGet(url, input.authorization);
    if (!Array.isArray(response.body)) {
      throw new ProviderError('PROVIDER_RESPONSE_INVALID', 'Strava returned an invalid activity page.', false, null, response.status);
    }
    const rawActivities = response.body.map((item) => requireRecord(item, 'activity'));
    return {
      activities: rawActivities.map(parseActivity),
      rawActivities,
      rateLimit: parseRateLimit(response.headers, response.status),
    };
  }

  async fetchActivity(input: ActivityRequest): Promise<ProviderActivity | null> {
    const activityId = providerId(input.providerActivityId, 'activity id');
    const response = await this.transport.request({
      method: 'GET',
      url: new URL(`/api/v3/activities/${encodeURIComponent(activityId)}`, this.apiBaseUrl),
      headers: { authorization: `Bearer ${requireText(input.authorization.accessToken, 10_000, 'access token')}` },
    });
    if (response.status === 404) return null;
    ensureSuccess(response, 'Strava activity could not be loaded.');
    return parseActivity(requireRecord(response.body, 'activity'));
  }

  private async authorizedGet(url: URL, authorization: ProviderAuthorization): Promise<HttpResponse> {
    const response = await this.transport.request({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${requireText(authorization.accessToken, 10_000, 'access token')}` },
    });
    ensureSuccess(response, 'Strava activities could not be loaded.');
    return response;
  }

  private async tokenRequest(url: URL, fields: Record<string, string>): Promise<ProviderAuthorization> {
    const response = await this.transport.request({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
    ensureSuccess(response, 'Strava authorization failed.');
    const body = requireRecord(response.body, 'authorization response');
    const athlete = requireRecord(body.athlete, 'athlete');
    const expiresAt = new Date(requireFiniteNumber(body.expires_at, 'expires_at') * 1000);
    return {
      providerAccountId: providerId(athlete.id, 'athlete id'),
      displayName: displayName(athlete),
      accessToken: requireText(body.access_token, 10_000, 'access token'),
      refreshToken: requireText(body.refresh_token, 10_000, 'refresh token'),
      expiresAt,
      scopes: parseScopes(body.scope),
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
    const text = await response.text();
    let body: unknown = null;
    if (text !== '') {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text.slice(0, 500);
      }
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
    distanceM: integerOrNull(activity.distanceM),
    movingTimeS: integerOrNull(activity.movingTimeS ?? activity.elapsedTimeS),
  })).digest('hex');
}

export function canonicalActivityType(activity: ProviderActivity): 'run' | 'bike' | 'swim' | 'workout' | 'rowing' | 'sup' | null {
  const value = (activity.sportType ?? activity.type).replace(/[^A-Za-z]/g, '').toLowerCase();
  if (['run', 'trailrun', 'virtualrun', 'wheelchair'].includes(value)) return 'run';
  if (['ride', 'mountainbikeride', 'gravelride', 'virtualride', 'ebikeride', 'velomobile'].includes(value)) return 'bike';
  if (['swim'].includes(value)) return 'swim';
  if (['rowing', 'virtualrowing'].includes(value)) return 'rowing';
  if (['standuppaddling', 'sup'].includes(value)) return 'sup';
  if (['workout', 'weighttraining', 'crossfit', 'elliptical', 'stairmapper', 'yoga', 'pilates'].includes(value)) return 'workout';
  return null;
}

function parseActivity(raw: Record<string, unknown>): ProviderActivity {
  const startDate = validDate(raw.start_date, 'activity start date');
  const localDateValue = typeof raw.start_date_local === 'string' ? raw.start_date_local.slice(0, 10) : startDate.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDateValue)) {
    throw new ProviderError('PROVIDER_RESPONSE_INVALID', 'Strava returned an invalid local activity date.', false);
  }
  return {
    providerActivityId: providerId(raw.id, 'activity id'),
    providerUpdatedAt: optionalDate(raw.updated_at),
    name: optionalText(raw.name, 500),
    type: requireText(raw.type, 100, 'activity type'),
    sportType: optionalText(raw.sport_type, 100),
    startDate,
    localDate: localDateValue,
    timezone: optionalText(raw.timezone, 200),
    distanceM: optionalNonNegative(raw.distance, 'distance'),
    elapsedTimeS: optionalNonNegative(raw.elapsed_time, 'elapsed time'),
    movingTimeS: optionalNonNegative(raw.moving_time, 'moving time'),
    elevationGainM: optionalNonNegative(raw.total_elevation_gain, 'elevation gain'),
    averageHeartrate: optionalNonNegative(raw.average_heartrate, 'average heart rate'),
    maxHeartrate: optionalNonNegative(raw.max_heartrate, 'maximum heart rate'),
    averageSpeedMps: optionalNonNegative(raw.average_speed, 'average speed'),
    calories: optionalNonNegative(raw.calories, 'calories'),
    isManual: raw.manual === true,
    isIndoor: raw.trainer === true || raw.indoor === true,
    isPrivate: raw.private === true,
    isRace: raw.workout_type === 1,
    raw,
  };
}

function ensureSuccess(response: HttpResponse, message: string): void {
  if (response.status >= 200 && response.status < 300) return;
  throw providerResponseError(response, message);
}

function providerResponseError(response: HttpResponse, message: string): ProviderError {
  if (response.status === 401 || response.status === 403) {
    return new ProviderError('PROVIDER_REAUTHORIZATION_REQUIRED', message, false, null, response.status);
  }
  const rateLimit = parseRateLimit(response.headers, response.status);
  if (response.status === 429) {
    return new ProviderError('PROVIDER_RATE_LIMITED', 'The provider rate limit was reached.', true, rateLimit.retryAt, response.status);
  }
  if (response.status >= 500) {
    return new ProviderError('PROVIDER_UNAVAILABLE', message, true, null, response.status);
  }
  return new ProviderError('PROVIDER_AUTHORIZATION_FAILED', message, false, null, response.status);
}

function parseRateLimit(headers: Record<string, string>, status: number): ProviderRateLimit {
  const limits = integerPair(headers['x-ratelimit-limit'] ?? headers['x-readratelimit-limit']);
  const usage = integerPair(headers['x-ratelimit-usage'] ?? headers['x-readratelimit-usage']);
  const now = new Date();
  const shortExhausted = limits[0] !== null && usage[0] !== null && usage[0] >= limits[0];
  const dailyExhausted = limits[1] !== null && usage[1] !== null && usage[1] >= limits[1];
  return {
    shortLimit: limits[0],
    shortUsage: usage[0],
    dailyLimit: limits[1],
    dailyUsage: usage[1],
    retryAt: status === 429 || shortExhausted || dailyExhausted
      ? (dailyExhausted ? nextUtcMidnight(now) : nextQuarterHour(now))
      : null,
  };
}

function integerPair(value: string | undefined): [number | null, number | null] {
  if (!value) return [null, null];
  const values = value.split(',').map((item) => Number(item.trim()));
  return [safeInteger(values[0]), safeInteger(values[1])];
}

function nextQuarterHour(now: Date): Date {
  const next = new Date(now.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(Math.floor(next.getUTCMinutes() / 15) * 15 + 15);
  return next;
}

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function displayName(athlete: Record<string, unknown>): string | null {
  const combined = [optionalText(athlete.firstname, 100), optionalText(athlete.lastname, 100)].filter(Boolean).join(' ').trim();
  return combined || optionalText(athlete.username, 200);
}

function parseScopes(value: unknown): string[] {
  if (Array.isArray(value)) return normalizedScopes(value.filter((scope): scope is string => typeof scope === 'string'));
  if (typeof value === 'string') return normalizedScopes(value.split(','));
  return [];
}

function normalizedScopes(scopes: string[]): string[] {
  const normalized = [...new Set(scopes.map((scope) => requireText(scope, 100, 'scope').toLowerCase()))].sort();
  if (normalized.length === 0) throw new ProviderError('PROVIDER_SCOPE_MISSING', 'At least one provider scope is required.', false);
  return normalized;
}

function providerId(value: unknown, name: string): string {
  if (typeof value === 'string') return requireText(value, 200, name);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Strava returned an invalid ${name}.`, false);
}

function requireText(value: unknown, maximum: number, name: string): string {
  if (typeof value !== 'string') throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false);
  return normalized;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, maximum, 'provider text');
}

function optionalNonNegative(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  const number = requireFiniteNumber(value, name);
  if (number < 0) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false);
  return number;
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false);
  }
  return value;
}

function safeInteger(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function integerOrNull(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value);
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false);
  }
  return value;
}

function unixSeconds(value: Date): number {
  const date = validDate(value, 'cursor date');
  return Math.floor(date.getTime() / 1000);
}

function validDate(value: unknown, name: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(typeof value === 'string' ? value : Number.NaN);
  if (!Number.isFinite(date.getTime())) throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Invalid ${name}.`, false);
  return date;
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null;
  return validDate(value, 'provider update date');
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderError('PROVIDER_RESPONSE_INVALID', `Strava returned an invalid ${name}.`, false);
  }
  return value as Record<string, unknown>;
}

function validUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new ProviderError('PROVIDER_CONFIGURATION_ERROR', 'Provider redirect URL must use HTTPS.', false);
  }
  return url;
}

function baseUrl(value: string): URL {
  const url = validUrl(value);
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url;
}
