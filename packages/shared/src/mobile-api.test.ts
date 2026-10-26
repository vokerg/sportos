import { describe, expect, it, vi } from 'vitest';
import { MobileApiClient, MobileApiError, type SecureSessionStore } from './mobile-api.js';

const token = 'smo_' + 'a'.repeat(64);
const session = {
  account: { id: 'synthetic-owner', displayName: 'Fixture', email: null },
  expiresAt: '2099-01-01T00:00:00Z',
  absoluteExpiresAt: '2099-01-02T00:00:00Z',
};
const fixture = () => {
  let saved: string | null = null;
  const store: SecureSessionStore = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (next: string) => { saved = next; }),
    remove: vi.fn(async () => { saved = null; }),
  };
  return { store, set: (next: string) => { saved = next; }, get: () => saved };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('MobileApiClient', () => {
  it('refuses insecure remote API endpoints and credentials in base URLs', () => {
    const { store } = fixture();
    expect(() => new MobileApiClient('http://external.example', store)).toThrow(MobileApiError);
    expect(() => new MobileApiClient('https://user:password@api.example', store)).toThrow(MobileApiError);
    expect(() => new MobileApiClient('http://localhost:3010', store)).toThrow(MobileApiError);
    expect(() => new MobileApiClient('http://localhost:3010', store, fetch, true)).not.toThrow();
  });

  it('creates a sign-in request with no ambient cookie and only canonical API origin', async () => {
    const { store } = fixture();
    const fetcher = vi.fn(async (_url: string, opts: RequestInit) => {
      expect(opts.credentials).toBe('omit');
      expect(opts.redirect).toBe('error');
      expect(opts.headers).not.toHaveProperty('Authorization');
      return json({ requestId: 'r'.repeat(43), authorizationUrl: 'https://web.example/mobile-connect', expiresAt: '2099-01-01' });
    });
    const api = new MobileApiClient('https://api.example', store, fetcher as unknown as typeof fetch);
    const result = await api.startSignIn('c'.repeat(43), 's'.repeat(43));
    expect(result.requestId).toHaveLength(43);
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.example/auth/mobile/start');
  });

  it('rejects intercepted callbacks with wrong state, origin, route or extra parameters', async () => {
    const { store } = fixture();
    const fetcher = vi.fn();
    const api = new MobileApiClient('https://api.example', store, fetcher as unknown as typeof fetch);
    const valid = 'sportos://auth/callback?code=' + 'c'.repeat(43) + '&state=' + 's'.repeat(43);
    await expect(api.finishSignIn(valid.replace('state=', 'state=wrong'), 's'.repeat(43), 'v'.repeat(64))).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.finishSignIn(valid.replace('sportos:', 'https:'), 's'.repeat(43), 'v'.repeat(64))).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.finishSignIn(valid + '&token=leak', 's'.repeat(43), 'v'.repeat(64))).rejects.toMatchObject({ kind: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('exchanges a one-time code without cookies and saves only the resulting bearer in secure storage', async () => {
    const { store, get } = fixture();
    const fetcher = vi.fn(async (_url: string, opts: RequestInit) => {
      expect(opts.credentials).toBe('omit');
      expect(opts.headers).not.toHaveProperty('Authorization');
      expect(JSON.parse(String(opts.body))).toEqual({
        code: 'c'.repeat(43), state: 's'.repeat(43), codeVerifier: 'v'.repeat(64),
      });
      return json({ ...session, token });
    });
    const api = new MobileApiClient('https://api.example', store, fetcher as unknown as typeof fetch);
    const result = await api.finishSignIn('sportos://auth/callback?code=' + 'c'.repeat(43) + '&state=' + 's'.repeat(43), 's'.repeat(43), 'v'.repeat(64));
    expect(result).toEqual(session);
    expect(get()).toBe(token);
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.example/auth/mobile/exchange');
  });

  it('restores an authenticated server session and prevents cross-origin path redirects', async () => {
    const { store, set } = fixture();
    set(token);
    const fetcher = vi.fn(async (_url: string, opts: RequestInit) => {
      expect(opts.headers).toHaveProperty('Authorization', `Bearer ${token}`);
      return json(session);
    });
    const api = new MobileApiClient('https://api.example/api', store, fetcher as unknown as typeof fetch);
    expect(await api.restore()).toEqual(session);
    expect(await api.get('/activities')).toEqual(session);
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.example/api/auth/session');
    await expect(api.get('//attacker.example')).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.get('/../auth/session')).rejects.toMatchObject({ kind: 'invalid' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed and clears secure storage when a session is revoked or expired', async () => {
    const { store, set, get } = fixture();
    set(token);
    const fetcher = vi.fn(async () => json({ message: 'unknown private error' }, 401));
    const api = new MobileApiClient('https://api.example', store, fetcher as unknown as typeof fetch);
    expect(await api.restore()).toBeNull();
    expect(get()).toBeNull();
    await expect(api.get('/activities')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('fails closed on network loss and distinguishes local-only sign-out from server revocation', async () => {
    const { store, set, get } = fixture();
    set(token);
    const fetcher = vi.fn(async () => { throw new Error('secret upstream details'); });
    const api = new MobileApiClient('https://api.example', store, fetcher as unknown as typeof fetch);
    await expect(api.restore()).rejects.toMatchObject({ kind: 'network' });
    expect(await api.signOut()).toBe('local-only');
    expect(get()).toBeNull();
  });

  it('does not leak raw API errors into the UI', async () => {
    const { store, set } = fixture();
    set(token);
    const fetcher = vi.fn(async () => json({ message: 'PRIVATE DATA SHOULD NEVER BE ECHOED' }, 500));
    const api = new MobileApiClient('https://api.example', store, fetcher as unknown as typeof fetch);
    await expect(api.restore()).rejects.toThrow('SportOS is temporarily unavailable.');
  });
});
