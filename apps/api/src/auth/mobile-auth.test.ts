import { createHash, scryptSync } from 'node:crypto';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, sha256 } from './auth.service.js';
import type { DbProvider } from '../db.provider.js';
import type { AuthenticatedSession } from './auth.models.js';

const verifier = 'v'.repeat(64);
const state = 's'.repeat(48);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const password = 'synthetic-password-not-production';
const salt = Buffer.alloc(16, 7);
const hash = scryptSync(password, salt, 64, { N: 65_536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const encoded = `scrypt-v1:${salt.toString('hex')}:${hash.toString('hex')}`;
const account = { id: LEGACY_ACCOUNT_ID, display_name: 'Fixture', email: null, status: 'active' };
const browserSession: AuthenticatedSession = {
  id: 'synthetic-browser-session',
  account: { id: LEGACY_ACCOUNT_ID, displayName: 'Fixture', email: null },
  csrfHash: '0'.repeat(64),
  expiresAt: '2099-01-01T00:00:00.000Z',
  absoluteExpiresAt: '2099-01-02T00:00:00.000Z',
};

describe('PKCE-approved mobile sign-in', () => {
  let auth: AuthService;
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SPORTOS_AUTH_MODE', 'single-user');
    vi.stubEnv('SPORTOS_WEB_ORIGIN', 'https://sportos.example');
    vi.stubEnv('SPORTOS_SINGLE_USER_USERNAME', 'sportos');
    vi.stubEnv('SPORTOS_SINGLE_USER_PASSWORD_HASH', encoded);
    auth = new AuthService({ db: {} } as DbProvider);
    vi.spyOn(AuthRepository.prototype, 'createMobileAuthRequest').mockResolvedValue();
    vi.spyOn(AuthRepository.prototype, 'approveMobileAuthRequest').mockResolvedValue(state);
    vi.spyOn(AuthRepository.prototype, 'consumeMobileAuthRequest').mockResolvedValue(LEGACY_ACCOUNT_ID);
    vi.spyOn(AuthRepository.prototype, 'createSession').mockResolvedValue('server-session-id');
    vi.spyOn(AuthRepository.prototype, 'getAccount').mockResolvedValue(account as never);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('starts an unauthenticated one-time request with only digest and challenge persisted', async () => {
    const started = await auth.startMobileSignIn({ codeChallenge: challenge, state }, undefined);
    const arg = vi.mocked(AuthRepository.prototype.createMobileAuthRequest).mock.calls[0]![0];
    expect(arg.requestHash).toBe(sha256(started.requestId));
    expect(arg.requestHash).not.toBe(started.requestId);
    expect(arg.state).toBe(state);
    expect(arg.codeChallenge).toBe(challenge);
    expect(started.authorizationUrl).toBe(`https://sportos.example/mobile-connect?request=${started.requestId}`);
    expect(new Date(started.expiresAt).valueOf()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(arg)).not.toContain(password);
  });

  it('requires an explicitly approved browser cookie session and never accepts an owner argument', async () => {
    await expect(auth.approveMobileSignIn({ requestId: 'r'.repeat(43) }, browserSession, 'bearer')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(auth.approveMobileSignIn({ requestId: 'r'.repeat(43), ownerId: 'foreign' }, browserSession, 'cookie')).rejects.toBeInstanceOf(BadRequestException);
    const approved = await auth.approveMobileSignIn({ requestId: 'r'.repeat(43) }, browserSession, 'cookie');
    expect(approved.redirectUrl).toMatch(/^sportos:\/\/auth\/callback\?code=/);
    expect(new URL(approved.redirectUrl).searchParams.get('state')).toBe(state);
    const arg = vi.mocked(AuthRepository.prototype.approveMobileAuthRequest).mock.calls[0]![0];
    expect(arg.accountId).toBe(LEGACY_ACCOUNT_ID);
    expect(arg.codeHash).toBe(sha256(new URL(approved.redirectUrl).searchParams.get('code')!));
    expect(arg.requestHash).toBe(sha256('r'.repeat(43)));
  });

  it('exchanges a PKCE-bound code for a distinct hashed and revocable mobile session', async () => {
    const result = await auth.exchangeMobileSignIn({ code: 'c'.repeat(43), state, codeVerifier: verifier }, undefined);
    expect(result.token).toMatch(/^smo_[A-Za-z0-9_-]{64}$/);
    const consumed = vi.mocked(AuthRepository.prototype.consumeMobileAuthRequest).mock.calls[0]![0];
    expect(consumed).toEqual({ codeHash: sha256('c'.repeat(43)), state, codeChallenge: challenge });
    const stored = vi.mocked(AuthRepository.prototype.createSession).mock.calls[0]![0];
    expect(stored.accountId).toBe(LEGACY_ACCOUNT_ID);
    expect(stored.tokenHash).toBe(sha256(result.token));
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(result).not.toHaveProperty('csrfToken');
    expect(result).not.toHaveProperty('sessionId');
    expect(result.account.id).toBe(LEGACY_ACCOUNT_ID);
  });

  it('rejects wrong or replayed codes, other origins, forged owner, and unavailable accounts', async () => {
    await expect(auth.startMobileSignIn({ codeChallenge: challenge, state }, 'https://evil.example')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(auth.exchangeMobileSignIn({ code: 'c'.repeat(43), state, codeVerifier: verifier }, 'https://sportos.example')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(auth.exchangeMobileSignIn({ code: 'c'.repeat(43), state, codeVerifier: verifier, accountId: LEGACY_ACCOUNT_ID }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    vi.mocked(AuthRepository.prototype.consumeMobileAuthRequest).mockResolvedValueOnce(null);
    await expect(auth.exchangeMobileSignIn({ code: 'c'.repeat(43), state, codeVerifier: verifier }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    vi.mocked(AuthRepository.prototype.getAccount).mockResolvedValue(undefined);
    await expect(auth.exchangeMobileSignIn({ code: 'c'.repeat(43), state, codeVerifier: verifier }, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not let a browser cookie token authenticate as bearer or vice versa', async () => {
    const found = {
      sessionId: 'server-session-id', account: browserSession.account, csrfHash: 'a'.repeat(64),
      expiresAt: browserSession.expiresAt, absoluteExpiresAt: browserSession.absoluteExpiresAt,
      lastSeenAt: new Date().toISOString(),
    };
    vi.spyOn(AuthRepository.prototype, 'findActiveSession').mockResolvedValue(found);
    expect(await auth.authenticate('smo_' + 'a'.repeat(64))).toBeNull();
    expect(await auth.authenticate('b'.repeat(64), 'mobile')).toBeNull();
    expect(await auth.authenticate('smo_' + 'a'.repeat(64), 'mobile')).toMatchObject({ account: browserSession.account });
    expect(await auth.authenticate('b'.repeat(64))).toMatchObject({ account: browserSession.account });
    vi.mocked(AuthRepository.prototype.findActiveSession).mockResolvedValue(null);
    expect(await auth.authenticate('smo_' + 'a'.repeat(64), 'mobile')).toBeNull();
  });

  it('rejects already-approved or expired browser handoffs without signing the web user out', async () => {
    vi.mocked(AuthRepository.prototype.approveMobileAuthRequest).mockResolvedValue(null);
    await expect(auth.approveMobileSignIn({ requestId: 'r'.repeat(43) }, browserSession, 'cookie')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves normal browser password login and CSRF cookie behavior', async () => {
    const browser = await auth.loginSingleUser({ username: 'sportos', password }, 'https://sportos.example');
    expect(browser.sessionToken).not.toMatch(/^smo_/);
    expect(auth.verifyCsrf(browser.session, browser.csrfToken, browser.csrfToken)).toBe(true);
    expect(auth.sessionCookieHeaders(browser)[0]).toContain('HttpOnly');
  });
});
