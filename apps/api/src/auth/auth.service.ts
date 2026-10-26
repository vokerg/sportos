import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import {
  AuthRepository,
  ExternalIdentityClaimError,
  LEGACY_ACCOUNT_ID,
} from '@sportos/db';
import { DbProvider } from '../db.provider.js';
import type { AuthenticatedSession } from './auth.models.js';
import { verifySingleUserPassword } from './single-user-password.js';

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

const DEV_SESSION_ID = 'dev-single-user';
const DEV_SESSION_IDLE_SECONDS = 43_200;
const DEV_SESSION_ABSOLUTE_SECONDS = 604_800;

@Injectable()
export class AuthService {
  private readonly repository: AuthRepository;
  private discoveryPromise?: Promise<OidcDiscovery>;
  private loginWindowStarted = 0;
  private loginAttempts = 0;
  private loginInProgress = false;
  private mobileWindowStarted = 0;
  private mobileRequests = 0;

  constructor(private readonly database: DbProvider) {
    this.repository = new AuthRepository(database.db);
  }

  isDevelopmentMode(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.SPORTOS_AUTH_MODE === 'dev-single-user';
  }

  loginMode(): 'single-user' | 'oidc' {
    return process.env.SPORTOS_AUTH_MODE === 'single-user' ? 'single-user' : 'oidc';
  }

  async loginSingleUser(input: unknown, origin: string | undefined, userAgent?: string): Promise<SessionIssueResult> {
    if (this.loginMode() !== 'single-user') throw new UnauthorizedException('Sign-in is unavailable.');
    if (!origin || origin !== String(process.env.SPORTOS_WEB_ORIGIN ?? '').replace(/\/$/, '')) {
      throw new ForbiddenException('The request could not be verified.');
    }
    if (Date.now() - this.loginWindowStarted >= 60_000) {
      this.loginWindowStarted = Date.now();
      this.loginAttempts = 0;
    }
    if (this.loginInProgress || this.loginAttempts >= 10) {
      throw new HttpException('Too many sign-in attempts. Try again in a minute.', 429);
    }
    this.loginAttempts += 1;
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !['username', 'password'].includes(key))) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    const { username, password } = input as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || username.length > 100
      || typeof password !== 'string' || password.length < 1 || password.length > 256) {
      throw new UnauthorizedException('Invalid username or password.');
    }
    this.loginInProgress = true;
    try {
      if (!await verifySingleUserPassword(username, password)) throw new UnauthorizedException('Invalid username or password.');
      const account = await this.repository.getAccount(LEGACY_ACCOUNT_ID);
      if (!account || account.status !== 'active') throw new UnauthorizedException('Invalid username or password.');
      return await this.issueSession(account.id, account.display_name, account.email, '/', userAgent);
    } finally {
      this.loginInProgress = false;
    }
  }

  async getDevelopmentSession(): Promise<AuthenticatedSession> {
    const account = await this.repository.getAccount(LEGACY_ACCOUNT_ID);
    if (!account) throw new ServiceUnavailableException({ code: 'LEGACY_ACCOUNT_MISSING', message: 'The local account is unavailable.' });
    const now = Date.now();
    return {
      id: DEV_SESSION_ID,
      account: { id: account.id, displayName: account.display_name, email: account.email },
      csrfHash: '',
      expiresAt: new Date(now + DEV_SESSION_IDLE_SECONDS * 1000).toISOString(),
      absoluteExpiresAt: new Date(now + DEV_SESSION_ABSOLUTE_SECONDS * 1000).toISOString(),
    };
  }

  async beginLogin(returnToValue?: string): Promise<string> {
    if (this.loginMode() === 'single-user') throw new UnauthorizedException('Use the username and password form.');
    const returnTo = normalizeReturnTo(returnToValue);
    if (this.isDevelopmentMode()) {
      const webOrigin = String(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4210').replace(/\/$/, '');
      return `${webOrigin}${returnTo}`;
    }

    const config = this.oidcConfig();
    const discovery = await this.discovery(config.issuer);
    const state = randomToken(32);
    const verifier = randomToken(64);
    const nonce = randomToken(32);
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
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
    if (this.loginMode() === 'single-user') throw new UnauthorizedException('OIDC sign-in is unavailable.');
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
    const token = await tokenResponse.json() as { access_token?: unknown };
    const accessToken = typeof token.access_token === 'string' ? token.access_token : '';
    if (!accessToken) throw new UnauthorizedException({ code: 'OIDC_TOKEN_INVALID', message: 'Sign-in could not be completed.' });

    const userInfoResponse = await fetch(discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!userInfoResponse.ok) throw new UnauthorizedException({ code: 'OIDC_USERINFO_FAILED', message: 'Sign-in could not be completed.' });
    const userInfo = await userInfoResponse.json() as OidcUserInfo;
    const subject = typeof userInfo.sub === 'string' ? userInfo.sub.trim() : '';
    if (!subject || subject.length > 500) throw new UnauthorizedException({ code: 'OIDC_SUBJECT_INVALID', message: 'Sign-in could not be completed.' });

    let account;
    try {
      account = await this.repository.provisionExternalIdentity({
        issuer: discovery.issuer,
        subject,
        email: typeof userInfo.email === 'string' ? userInfo.email : null,
        displayName: typeof userInfo.name === 'string'
          ? userInfo.name
          : typeof userInfo.preferred_username === 'string' ? userInfo.preferred_username : null,
        preferredAccountId: configuredLegacyClaim(discovery.issuer, subject),
      });
    } catch (error) {
      if (error instanceof ExternalIdentityClaimError) {
        throw new UnauthorizedException({
          code: 'OIDC_ACCOUNT_CLAIM_FAILED',
          message: 'Sign-in could not be completed.',
        });
      }
      throw error;
    }
    return this.issueSession(account.id, account.display_name, account.email, transaction.returnTo, userAgent);
  }

  async createDevelopmentSession(authorizationHeader: string | undefined, userAgent?: string): Promise<SessionIssueResult> {
    if (process.env.NODE_ENV === 'production' || this.loginMode() === 'single-user') {
      throw new UnauthorizedException({ code: 'DEV_AUTH_DISABLED', message: 'Development sign-in is unavailable.' });
    }
    const expected = String(process.env.SPORTOS_DEV_AUTH_TOKEN ?? '');
    const provided = String(authorizationHeader ?? '').replace(/^Bearer\s+/i, '');
    if (!expected || !safeEqual(expected, provided)) {
      throw new UnauthorizedException({ code: 'DEV_AUTH_DISABLED', message: 'Development sign-in is unavailable.' });
    }
    const account = await this.repository.getAccount(LEGACY_ACCOUNT_ID);
    if (!account) throw new ServiceUnavailableException({ code: 'LEGACY_ACCOUNT_MISSING', message: 'The local account is unavailable.' });
    return this.issueSession(account.id, account.display_name, account.email, '/', userAgent);
  }


  async startMobileSignIn(input: unknown, origin: string | undefined) {
    requireNativeRequest(origin);
    const value = strictObject(input, ['codeChallenge', 'state']);
    const codeChallenge = value.codeChallenge;
    const state = value.state;
    if (!isRandomUrlToken(codeChallenge, 43, 43) || !isRandomUrlToken(state, 32, 128)) {
      throw new UnauthorizedException('Invalid mobile sign-in request.');
    }
    if (Date.now() - this.mobileWindowStarted >= 60_000) {
      this.mobileWindowStarted = Date.now();
      this.mobileRequests = 0;
    }
    if (++this.mobileRequests > 30) {
      throw new HttpException('Too many sign-in requests. Try again in a minute.', 429);
    }
    const requestId = randomToken(32);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await this.repository.createMobileAuthRequest({
      requestHash: sha256(requestId), codeChallenge, state, expiresAt,
    });
    const webOrigin = String(process.env.SPORTOS_WEB_ORIGIN ?? 'http://localhost:4210').replace(/\/$/, '');
    return {
      requestId,
      authorizationUrl: `${webOrigin}/mobile-connect?request=${encodeURIComponent(requestId)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async approveMobileSignIn(input: unknown, session: AuthenticatedSession, transport: 'cookie' | 'bearer' | undefined) {
    if (transport !== 'cookie') throw new ForbiddenException('Browser confirmation is required.');
    const value = strictObject(input, ['requestId']);
    if (!isRandomUrlToken(value.requestId, 43, 43)) {
      throw new UnauthorizedException('Mobile sign-in is unavailable or expired.');
    }
    const code = randomToken(32);
    const state = await this.repository.approveMobileAuthRequest({
      requestHash: sha256(value.requestId),
      accountId: session.account.id,
      codeHash: sha256(code),
    });
    if (!state) throw new UnauthorizedException('Mobile sign-in is unavailable or expired.');
    // Fixed app scheme; only one-time code + state enter the URL, never the bearer token.
    // #188 must register exactly this scheme in its Expo configuration.
    const url = new URL('sportos://auth/callback');
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    return { redirectUrl: url.toString() };
  }

  async exchangeMobileSignIn(input: unknown, origin: string | undefined, userAgent?: string) {
    requireNativeRequest(origin);
    const value = strictObject(input, ['code', 'state', 'codeVerifier']);
    const { code, state, codeVerifier } = value;
    if (!isRandomUrlToken(code, 43, 43) || !isRandomUrlToken(state, 32, 128)
      || !isRandomUrlToken(codeVerifier, 43, 128)) {
      throw new UnauthorizedException('Mobile sign-in is invalid or expired.');
    }
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const accountId = await this.repository.consumeMobileAuthRequest({
      codeHash: sha256(code), state, codeChallenge,
    });
    if (!accountId) throw new UnauthorizedException('Mobile sign-in is invalid or expired.');
    const account = await this.repository.getAccount(accountId);
    if (!account || account.status !== 'active') {
      throw new UnauthorizedException('Mobile sign-in is invalid or expired.');
    }
    const result = await this.issueSession(account.id, account.display_name, account.email, '/', userAgent, 'mobile');
    return {
      token: result.sessionToken,
      account: result.session.account,
      expiresAt: result.session.expiresAt,
      absoluteExpiresAt: result.session.absoluteExpiresAt,
    };
  }

  async authenticate(sessionToken: string | null, transport: 'browser' | 'mobile' = 'browser'): Promise<AuthenticatedSession | null> {
    if (transport === 'mobile' && !/^smo_[A-Za-z0-9_-]{64}$/.test(sessionToken ?? '')) return null;
    if (transport === 'browser' && (sessionToken ?? '').startsWith('smo_')) return null;

    if (!sessionToken || sessionToken.length < 32 || sessionToken.length > 500) return null;
    const result = await this.repository.findActiveSession(sha256(sessionToken));
    if (!result) return null;
    if (this.loginMode() === 'single-user' && result.account.id !== LEGACY_ACCOUNT_ID) return null;

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
    transport: 'browser' | 'mobile' = 'browser',
  ): Promise<SessionIssueResult> {
    const sessionToken = transport === 'mobile' ? `smo_${randomToken(48)}` : randomToken(48);
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
      redirectUri: `${String(process.env.SPORTOS_API_ORIGIN ?? 'http://localhost:3010').replace(/\/$/, '')}/auth/callback`,
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

function configuredLegacyClaim(issuer: string, subject: string): string | null {
  const configuredIssuer = String(process.env.SPORTOS_LEGACY_OIDC_ISSUER ?? '').replace(/\/$/, '');
  const configuredSubject = String(process.env.SPORTOS_LEGACY_OIDC_SUBJECT ?? '').trim();
  return configuredIssuer && configuredSubject && configuredIssuer === issuer && configuredSubject === subject
    ? LEGACY_ACCOUNT_ID
    : null;
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

function strictObject(value: unknown, keys: string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))
    || Object.values(value).some((field) => typeof field !== 'string')) {
    throw new UnauthorizedException('Invalid mobile sign-in request.');
  }
  return value as Record<string, string>;
}

function isRandomUrlToken(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);
}

function requireNativeRequest(origin: string | undefined): void {
  // This is a non-cookie JSON API. Browser fetches supply Origin, and the CORS
  // policy does not grant cross-origin access. Native uses an explicit verifier.
  if (origin) throw new ForbiddenException('Use the mobile application to sign in.');
}
