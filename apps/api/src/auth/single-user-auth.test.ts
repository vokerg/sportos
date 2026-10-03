import { scryptSync } from 'node:crypto';
import { ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import type { DbProvider } from '../db.provider.js';
import { validateHostedEnvironment } from '../hosted-config.js';

const password = 'synthetic-test-password-not-a-real-secret';
const salt = Buffer.alloc(16, 1);
const hash = scryptSync(password, salt, 64, { N: 65_536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const encoded = `scrypt-v1:${salt.toString('hex')}:${hash.toString('hex')}`;

describe('hosted single-user authentication', () => {
  let auth: AuthService;
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SPORTOS_AUTH_MODE', 'single-user');
    vi.stubEnv('SPORTOS_SINGLE_USER_USERNAME', 'sportos');
    vi.stubEnv('SPORTOS_SINGLE_USER_PASSWORD_HASH', encoded);
    vi.stubEnv('SPORTOS_WEB_ORIGIN', 'https://sportos.example');
    auth = new AuthService({ db: {} } as DbProvider);
    vi.spyOn(AuthRepository.prototype, 'getAccount').mockResolvedValue({
      id: LEGACY_ACCOUNT_ID, display_name: 'Athlete', email: null, status: 'active',
    } as never);
    vi.spyOn(AuthRepository.prototype, 'createSession').mockResolvedValue('session-id');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('issues opaque sessions for the fixed existing account, storing only digests', async () => {
    const result = await auth.loginSingleUser({ username: 'sportos', password }, 'https://sportos.example');
    expect(AuthRepository.prototype.getAccount).toHaveBeenCalledWith(LEGACY_ACCOUNT_ID);
    expect(result.session.account.id).toBe(LEGACY_ACCOUNT_ID);
    expect(result.sessionToken.length).toBeGreaterThan(32);
    const stored = vi.mocked(AuthRepository.prototype.createSession).mock.calls[0]![0];
    expect(stored.tokenHash).not.toBe(result.sessionToken);
    expect(stored.csrfHash).not.toBe(result.csrfToken);
    expect(JSON.stringify(stored)).not.toContain(password);
    expect(auth.sessionCookieHeaders(result)[0]).toContain('Secure; HttpOnly');
    expect(auth.verifyCsrf(result.session, result.csrfToken, result.csrfToken)).toBe(true);
    expect(auth.verifyCsrf(result.session, result.csrfToken, 'wrong')).toBe(false);
  });
  it('rejects wrong username or password without session creation', async () => {
    for (const input of [{ username: 'other', password }, { username: 'sportos', password: 'wrong' }]) {
      await expect(auth.loginSingleUser(input, 'https://sportos.example')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(AuthRepository.prototype.createSession).not.toHaveBeenCalled();
  });
  it('rejects cross-origin login and client-selected ownership', async () => {
    await expect(auth.loginSingleUser({ username: 'sportos', password }, 'https://other.example')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(auth.loginSingleUser({ username: 'sportos', password, ownerId: 'other' }, 'https://sportos.example')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(AuthRepository.prototype.createSession).not.toHaveBeenCalled();
  });
  it('bounds attempts and concurrent expensive password checks', async () => {
    const pending = auth.loginSingleUser({ username: 'sportos', password }, 'https://sportos.example');
    await expect(auth.loginSingleUser({ username: 'sportos', password }, 'https://sportos.example')).rejects.toMatchObject({ status: 429 });
    await pending;
    for (let i = 0; i < 9; i++) await expect(auth.loginSingleUser({}, 'https://sportos.example')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.loginSingleUser({}, 'https://sportos.example')).rejects.toBeInstanceOf(HttpException);
  });
  it('disables OIDC registration and development bypass in single-user mode', async () => {
    vi.stubEnv('SPORTOS_DEV_AUTH_TOKEN', 'test');
    await expect(auth.beginLogin('/')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.completeLogin('code', 'state')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(auth.createDevelopmentSession('Bearer test')).rejects.toBeInstanceOf(UnauthorizedException);
    vi.stubEnv('SPORTOS_AUTH_MODE', 'dev-single-user');
    expect(auth.isDevelopmentMode()).toBe(false);
  });
  it('rejects disabled accounts and sessions for any other owner', async () => {
    vi.mocked(AuthRepository.prototype.getAccount).mockResolvedValue(undefined);
    await expect(auth.loginSingleUser({ username: 'sportos', password }, 'https://sportos.example')).rejects.toBeInstanceOf(UnauthorizedException);
    vi.spyOn(AuthRepository.prototype, 'findActiveSession').mockResolvedValue({ account: { id: 'other' } } as never);
    expect(await auth.authenticate('a'.repeat(48))).toBeNull();
  });
  it('fails closed for production development auth or missing hash', () => {
    const base = { NODE_ENV: 'production', SPORTOS_WEB_ORIGIN: 'https://sportos.example', SPORTOS_API_ORIGIN: 'https://sportos.example/api', SPORTOS_AUTH_MODE: 'single-user', SPORTOS_SINGLE_USER_USERNAME: 'sportos', SPORTOS_SINGLE_USER_PASSWORD_HASH: encoded };
    expect(() => validateHostedEnvironment(base)).not.toThrow();
    expect(() => validateHostedEnvironment({ ...base, SPORTOS_DEV_AUTH_TOKEN: 'test' })).toThrow();
    expect(() => validateHostedEnvironment({ ...base, SPORTOS_SINGLE_USER_PASSWORD_HASH: '' })).toThrow();
    expect(() => validateHostedEnvironment({ ...base, SPORTOS_AUTH_MODE: 'dev-single-user' })).toThrow();
  });
});
