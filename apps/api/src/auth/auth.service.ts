import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { AuthRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { DbProvider } from '../db.provider.js';
import type { AuthenticatedSession } from './auth.models.js';

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

interface OidcUserInfo {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  preferred_username?: unknown;
}

export interface SessionIssueResult {
  sessionToken: string;
  csrfToken: string;
  session: AuthenticatedSession;
  returnTo: string;
}

@Injectable()
export class AuthService {
  private readonly repository: AuthRepository;
  private discoveryPromise?: Promise<OidcDiscovery>;

  constructor(private readonly database: DbProvider) {
    this.repository = new AuthRepository(database.db);
  }

  async beginLogin(returnToValue?: string): Promise<string> {
    const config = this.oidcConfig();
    const discovery = await this.discovery(config.issuer);
    const state = randomToken(32);
    const verifier = randomToken(64);
    const nonce = randomToken(32);
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const returnTo = normalizeReturnTo(returnToValue);

    await this.repository.createAuthorizationTransaction({
      stateHash: sha256(state),
      codeVerifier: verifier,
      nonce,
      returnTo,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', 'openid profile email');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async completeLogin(code: string, state: string, userAgent?: string): Promise<SessionIssueResult> {
    if (!code || !state) throw new UnauthorizedException({ code: 'OIDC_CALLBACK_INVALID', message: 'Sign-in could not be completed.' });
    const transaction = await this.repository.consumeAuthorizationTransaction(sha256(state));
    if (!transaction) throw new UnauthorizedException({ code: 'OIDC_STATE_INVALID', message: 'Sign-in state is invalid or expired.' });

    const config = this.oidcConfig();
    const discovery = await this.discovery(config.issuer);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: transaction.codeVerifier,
    });
    if (config.clientSecret) body.set('client_secret', config.clientSecret);

    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!tokenResponse.ok) throw new UnauthorizedException({ code: 'OIDC_TOKEN_FAILED', message: 'Sign-in could not be completed.' });
    const token = await tokenResponse.json() as { access_token?: unknown; token_type?: unknown };
    const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
    if (!accessToken) throw new UnauthorizedException({ code: 'OIDC_TOKEN_INVALID', message: 'Sign-in could not be completed.' });

    const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!userInfoResponse.ok) throw new UnauthorizedException({ code: 'OIDC_USERINFO_FAILED', message: 'Sign-in could not be completed.' });
    const userInfo = await userInfoResponse.json() as OidcUserInfo;
    const subject = typeof userInfo.sub === 'string' ? userInfo.sub.trim() : '';
    if (!subject || subject.length > 500) throw new UnauthorizedException({ code: 'OIDC_SUBJECT_INVALID', message: 'Sign-in could not be completed.' });

    const account = await this.repository.provisionExternalIdentity({
      issuer: discovery.issuer,
      subject,
      email: typeof userInfo.email === 'string' ? userInfo.email : null,
      displayName: typeof userInfo.name === 'string'
        ? userInfo.name
        : typeof userInfo.preferred_username === 'string' ? userInfo.preferred_username : null,
    });
    return this.issueSession(account.id, account.display_name, account.email, transaction.returnTo, userAgent);
  }

  async createDevelopmentSession(authorizationHeader: string | undefined, userAgent?: string): Promise<SessionIssueResult> {
    const expected = String(process.env.SPORTOS_DEV_AUTH_TOKEN ?? '');
    const provided = String(authorizationHeader ?? '').replace(/^Bearer\s+/i, '');
    if (!expected || !safeEqual(expected, provided)) {
      throw new UnauthorizedException({ code: 'DEV_AUTH_DISABLED', message: 'Development sign-in is unavailable.' });
    }
    const account = await this.repository.getAccount(LEGACY_ACCOUNT_ID);
    if (!account) throw new ServiceUnavailableException({ code: 'LEGACY_ACCOUNT_MISSING', message: 'The local account is unavailable.' });
    return this.issueSession(account.id, account.display_name, account.email, '/', userAgent);
  }

  async authenticate(sessionToken: string | null): Promise<AuthenticatedSession | null> {
    if (!sessionToken || sessionToken.length < 32 || sessionToken.length > 500) return null;
    const result = await this.repository.findActiveSession(sha256(sessionToken));
    if (!result) return null;

    const absoluteExpiry = new Date(result.absoluteExpiresAt).valueOf();
    const idleSeconds = boundedSeconds(process.env.SPORTOS_SESSION_IDLE_SECONDS, 43_200, 300, 86_400);
    const nextExpiryMs = Math.min(Date.now() + idleSeconds * 1000, absoluteExpiry);
    const lastSeen = new Date(result.lastSeenAt).valueOf();
    if (Date.now() - lastSeen > 5 * 60_000) {
      await this.repository.touchSession(result.sessionId, new Date(nextExpiryMs));
    }

    return {
      id: result.sessionId,
      account: result.account,
      csrfHash: result.csrfHash,
      expiresAt: new Date(nextExpiryMs).toISOString(),
      absoluteExpiresAt: result.absoluteExpiresAt,
    };
  }

  verifyCsrf(session: AuthenticatedSession, csrfCookie: string | null, csrfHeader: string | null): boolean {
    if (!csrfCookie || !csrfHeader || !safeEqual(csrfCookie, csrfHeader)) return false;
    return safeEqual(sha256(csrfHeader), session.csrfHash);
  }

  revokeSession(sessionId: string): Promise<void> {
    return this.repository.revokeSession(sessionId);
  }

  sessionCookieHeaders(result: SessionIssueResult): string[] {
    const secure = process.env.SPORTOS_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
    const common = `Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
    const maxAge = Math.max(0, Math.floor((new Date(result.session.absoluteExpiresAt).valueOf() - Date.now()) / 1000));
    return [
      `sportos_session=${encodeURIComponent(result.sessionToken)}; ${common}; HttpOnly; Max-Age=${maxAge}`,
      `sportos_csrf=${encodeURIComponent(result.csrfToken)}; ${common}; Max-Age=${maxAge}`,
    ];
  }

  clearCookieHeaders(): string[] {
    const secure = process.env.SPORTOS_COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
    const common = `Path=/; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0`;
    return [`sportos_session=; ${common}; HttpOnly`, `sportos_csrf=; ${common}`];
  }

  private async issueSession(
    accountId: string,
    displayName: string,
    email: string | null,
    returnTo: string,
    userAgent?: string,
  ): Promise<SessionIssueResult> {
    const sessionToken = randomToken(48);
    const csrfToken = randomToken(32);
    const idleSeconds = boundedSeconds(process.env.SPORTOS_SESSION_IDLE_SECONDS, 43_200, 300, 86_400);
    const absoluteSeconds = boundedSeconds(process.env.SPORTOS_SESSION_ABSOLUTE_SECONDS, 604_800, idleSeconds, 2_592_000);
    const now = Date.now();
    const expiresAt = new Date(now + idleSeconds * 1000);
    const absoluteExpiresAt = new Date(now + absoluteSeconds * 1000);
    const sessionId = await this.repository.createSession({
      accountId,
      tokenHash: sha256(sessionToken),
      csrfHash: sha256(csrfToken),
      userAgentHash: userAgent ? sha256(userAgent.slice(0, 1000)) : null,
      expiresAt,
      absoluteExpiresAt,
    });
    return {
      sessionToken,
      csrfToken,
      returnTo: normalizeReturnTo(returnTo),
      session: {
        id: sessionId,
        account: { id: accountId, displayName, email },
        csrfHash: sha256(csrfToken),
        expiresAt: expiresAt.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      },
    };
  }

  private oidcConfig() {
    const issuer = String(process.env.SPORTOS_OIDC_ISSUER ?? '').replace(/\/$/, '');
    const clientId = String(process.env.SPORTOS_OIDC_CLIENT_ID ?? '');
    if (!issuer || !clientId) {
      throw new ServiceUnavailableException({ code: 'OIDC_NOT_CONFIGURED', message: 'Sign-in is not configured.' });
    }
    const parsedIssuer = new URL(issuer);
    if (parsedIssuer.protocol !== 'https:' && parsedIssuer.hostname !== 'localhost' && parsedIssuer.hostname !== '127.0.0.1') {
      throw new ServiceUnavailableException({ code: 'OIDC_ISSUER_INSECURE', message: 'Sign-in is not configured securely.' });
    }
    return {
      issuer,
      clientId,
      clientSecret: String(process.env.SPORTOS_OIDC_CLIENT_SECRET ?? ''),
      redirectUri: `${String(process.env.SPORTOS_API_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')}/auth/callback`,
    };
  }

  private discovery(issuer: string): Promise<OidcDiscovery> {
    this.discoveryPromise ??= fetch(`${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new ServiceUnavailableException({ code: 'OIDC_DISCOVERY_FAILED', message: 'Sign-in provider is unavailable.' });
        const value = await response.json() as Partial<OidcDiscovery>;
        if (value.issuer !== issuer || !value.authorization_endpoint || !value.token_endpoint || !value.userinfo_endpoint) {
          throw new ServiceUnavailableException({ code: 'OIDC_DISCOVERY_INVALID', message: 'Sign-in provider configuration is invalid.' });
        }
        return value as OidcDiscovery;
      });
    return this.discoveryPromise;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes: number): string {
  return base64Url(randomBytes(bytes));
}

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeReturnTo(value: string | undefined): string {
  const candidate = String(value ?? '/').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//') && candidate.length <= 1000 ? candidate : '/';
}

function boundedSeconds(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
