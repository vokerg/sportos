export type ProviderCode = 'strava';
export type ProviderSyncMode = 'initial_backfill' | 'incremental' | 'webhook_refresh';

export interface AuthorizationRequest { state: string; redirectUri: string; scopes: string[]; }
export interface AuthorizationCodeExchange { code: string; redirectUri: string; }
export interface ProviderAuthorization {
  providerAccountId: string; displayName: string | null; accessToken: string; refreshToken: string; expiresAt: Date; scopes: string[];
}
export interface ActivityPageRequest { authorization: ProviderAuthorization; page: number; perPage: number; after?: Date; before?: Date; }
export interface ActivityRequest { authorization: ProviderAuthorization; providerActivityId: string; }
export interface ProviderRateLimit {
  shortLimit: number | null; shortUsage: number | null; dailyLimit: number | null; dailyUsage: number | null; retryAt: Date | null;
}
export interface ProviderActivity {
  providerActivityId: string; providerUpdatedAt: Date | null; name: string | null; type: string; sportType: string | null;
  startDate: Date; localDate: string; timezone: string | null; distanceM: number | null; elapsedTimeS: number | null;
  movingTimeS: number | null; elevationGainM: number | null; averageHeartrate: number | null; maxHeartrate: number | null;
  averageSpeedMps: number | null; calories: number | null; isManual: boolean; isIndoor: boolean; isPrivate: boolean; isRace: boolean;
  raw: Record<string, unknown>;
}
export interface ActivityPage { activities: ProviderActivity[]; rawActivities: Record<string, unknown>[]; rateLimit: ProviderRateLimit; }
export interface HttpRequest { method: 'GET' | 'POST'; url: URL; headers?: Record<string, string>; body?: string; }
export interface HttpResponse { status: number; headers: Record<string, string>; body: unknown; }
export interface ProviderHttpTransport { request(input: HttpRequest): Promise<HttpResponse>; }
export interface ProviderAdapter {
  readonly provider: ProviderCode;
  createAuthorizationUrl(input: AuthorizationRequest): URL;
  exchangeAuthorizationCode(input: AuthorizationCodeExchange): Promise<ProviderAuthorization>;
  refreshAuthorization(input: ProviderAuthorization): Promise<ProviderAuthorization>;
  revokeAuthorization(input: ProviderAuthorization): Promise<void>;
  fetchActivityPage(input: ActivityPageRequest): Promise<ActivityPage>;
  fetchActivity(input: ActivityRequest): Promise<ProviderActivity | null>;
}
export type ProviderErrorCode =
  | 'PROVIDER_CONFIGURATION_ERROR' | 'PROVIDER_AUTHORIZATION_FAILED' | 'PROVIDER_REAUTHORIZATION_REQUIRED'
  | 'PROVIDER_SCOPE_MISSING' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_RESPONSE_INVALID';
export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string, readonly retryable: boolean, readonly retryAt: Date | null = null, readonly status: number | null = null) {
    super(message); this.name = 'ProviderError';
  }
}
