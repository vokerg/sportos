import { AuthRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbProvider } from '../db.provider.js';
import { validateHostedEnvironment } from '../hosted-config.js';
import { AuthService, sha256 } from './auth.service.js';
import { GOOGLE_ISSUER } from './google-owner-auth.js';

const clientId = 'sportos-test.apps.googleusercontent.com';
const owner = { id: LEGACY_ACCOUNT_ID, display_name: 'Athlete', email: null, status: 'active' } as const;
const ownerSession = {
  id: 'owner-browser-session', account: { id: LEGACY_ACCOUNT_ID, displayName: 'Athlete', email: null },
  csrfHash: '', expiresAt: '', absoluteExpiresAt: '',
};
const provider = {
  issuer: GOOGLE_ISSUER,
  authorization_endpoint: `${GOOGLE_ISSUER}/authorize`,
  token_endpoint: 'https://oauth2.googleapis.com/token',
  userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
};

describe('personal Google sign-in', () => {
  let auth: AuthService;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let jwk: Awaited<ReturnType<typeof exportJWK>>;
  let token: string;
  let transaction: { nonce: string; codeVerifier: string; returnTo: string } | null;

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    jwk = { ...await exportJWK(keys.publicKey), kid: 'synthetic-google-key', alg: 'RS256' };
  });

  async function sign(subject: string, nonce = 'nonce', email = 'owner@example.test') {
    return new SignJWT({ nonce, email, email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-google-key' })
      .setIssuer(GOOGLE_ISSUER).setAudience(clientId).setSubject(subject)
      .setIssuedAt().setExpirationTime('10 min').sign(keys.privateKey);
  }

  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SPORTOS_AUTH_MODE', 'single-user-google');
    vi.stubEnv('SPORTOS_GOOGLE_ENROLLMENT', '');
    vi.stubEnv('SPORTOS_GOOGLE_OWNER_EMAIL', 'owner@example.test');
    vi.stubEnv('SPORTOS_OIDC_CLIENT_ID', clientId);
    vi.stubEnv('SPORTOS_OIDC_CLIENT_SECRET', 'synthetic-client-secret');
    vi.stubEnv('SPORTOS_API_ORIGIN', 'https://sportos.example/api');
    token = await sign('owner-subject');
    transaction = { nonce: 'nonce', codeVerifier: 'pkce', returnTo: '/' };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) return Response.json(provider);
      if (url === provider.token_endpoint) return Response.json({ id_token: token });
      if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
      throw new Error('Unexpected identity endpoint');
    }));
    vi.spyOn(AuthRepository.prototype, 'createAuthorizationTransaction').mockResolvedValue(undefined);
    vi.spyOn(AuthRepository.prototype, 'consumeAuthorizationTransaction').mockImplementation(async () => {
      const pending = transaction;
      transaction = null;
      return pending;
    });
    vi.spyOn(AuthRepository.prototype, 'findAccountByExternalIdentity').mockImplementation(async (_, subject) =>
      subject === 'owner-subject' ? owner as never : undefined);
    vi.spyOn(AuthRepository.prototype, 'provisionExternalIdentity').mockResolvedValue(owner as never);
    vi.spyOn(AuthRepository.prototype, 'createSession').mockResolvedValue('issued-session');
    auth = new AuthService({ db: {} } as DbProvider);
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('signs in the linked owner with signed Google claims and a one-time browser-bound state', async () => {
    const url = new URL(await auth.beginLogin('/mobile-connect'));
    const state = url.searchParams.get('state')!;
    expect(url.searchParams.get('redirect_uri')).toBe('https://sportos.example/api/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(auth.completeLogin('code', state, undefined, { googleState: 'other' })).rejects.toMatchObject({ status: 401 });
    expect(AuthRepository.prototype.consumeAuthorizationTransaction).not.toHaveBeenCalled();
    await expect(auth.completeLogin('code', state, undefined, { googleState: state }))
      .resolves.toMatchObject({ session: { account: { id: LEGACY_ACCOUNT_ID } } });
    expect(AuthRepository.prototype.findAccountByExternalIdentity).toHaveBeenCalledWith(GOOGLE_ISSUER, 'owner-subject', LEGACY_ACCOUNT_ID);
    expect(AuthRepository.prototype.provisionExternalIdentity).not.toHaveBeenCalled();
    await expect(auth.completeLogin('code', state, undefined, { googleState: state })).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a different Google subject even when its email matches', async () => {
    token = await sign('another-subject');
    await expect(auth.completeLogin('code', 'state', undefined, { googleState: 'state' }))
      .rejects.toMatchObject({ status: 401 });
    expect(AuthRepository.prototype.provisionExternalIdentity).not.toHaveBeenCalled();
    expect(AuthRepository.prototype.createSession).not.toHaveBeenCalled();
  });

  it('rejects invalid signed identity claims and disables password sign-in in Google-only mode', async () => {
    token = await sign('owner-subject', 'wrong-nonce');
    await expect(auth.completeLogin('code', 'state', undefined, { googleState: 'state' }))
      .rejects.toMatchObject({ status: 401 });
    await expect(auth.loginSingleUser({}, undefined)).rejects.toMatchObject({ status: 401 });
    expect(AuthRepository.prototype.findAccountByExternalIdentity).not.toHaveBeenCalled();
    expect(AuthRepository.prototype.createSession).not.toHaveBeenCalled();
  });

  it('binds enrollment to the current owner browser session and claims the legacy account', async () => {
    vi.stubEnv('SPORTOS_AUTH_MODE', 'single-user');
    vi.stubEnv('SPORTOS_GOOGLE_ENROLLMENT', 'true');
    vi.spyOn(auth, 'authenticate').mockImplementation(async value => value === 'owner-cookie' ? ownerSession : null);
    await expect(auth.beginGoogleEnrollment(ownerSession, 'bearer')).rejects.toMatchObject({ status: 403 });
    await expect(auth.beginLogin('/')).rejects.toMatchObject({ status: 401 });
    const url = new URL(await auth.beginGoogleEnrollment(ownerSession, 'cookie'));
    const state = url.searchParams.get('state')!;
    const stateHash = sha256(`google-enrollment:${ownerSession.id}:${state}`);
    expect(AuthRepository.prototype.createAuthorizationTransaction).toHaveBeenCalledWith(expect.objectContaining({ stateHash }));
    await expect(auth.completeLogin('code', state)).rejects.toMatchObject({ status: 401 });
    expect(AuthRepository.prototype.consumeAuthorizationTransaction).not.toHaveBeenCalled();
    await auth.completeLogin('code', state, undefined, { session: 'owner-cookie' });
    expect(AuthRepository.prototype.consumeAuthorizationTransaction).toHaveBeenCalledWith(stateHash);
    expect(AuthRepository.prototype.provisionExternalIdentity).toHaveBeenCalledWith({
      issuer: GOOGLE_ISSUER, subject: 'owner-subject', preferredAccountId: LEGACY_ACCOUNT_ID,
    });
  });

  it('rejects enrollment for a valid Google account outside the configured owner mailbox', async () => {
    vi.stubEnv('SPORTOS_AUTH_MODE', 'single-user');
    vi.stubEnv('SPORTOS_GOOGLE_ENROLLMENT', 'true');
    vi.spyOn(auth, 'authenticate').mockResolvedValue(ownerSession);
    token = await sign('another-subject', 'nonce', 'another@example.test');
    await expect(auth.completeLogin('code', 'state', undefined, { session: 'owner-cookie' }))
      .rejects.toMatchObject({ status: 401 });
    expect(AuthRepository.prototype.provisionExternalIdentity).not.toHaveBeenCalled();
    expect(AuthRepository.prototype.createSession).not.toHaveBeenCalled();
  });

  it('requires Google client configuration and accepts Google-only deployment without password settings', () => {
    const env = {
      NODE_ENV: 'production', SPORTOS_AUTH_MODE: 'single-user-google',
      SPORTOS_API_ORIGIN: 'https://sportos.example/api', SPORTOS_WEB_ORIGIN: 'https://sportos.example',
      SPORTOS_OIDC_CLIENT_ID: clientId, SPORTOS_OIDC_CLIENT_SECRET: 'synthetic-client-secret',
    };
    expect(() => validateHostedEnvironment(env)).not.toThrow();
    expect(() => validateHostedEnvironment({ ...env, SPORTOS_OIDC_CLIENT_SECRET: '' })).toThrow();
  });
});
