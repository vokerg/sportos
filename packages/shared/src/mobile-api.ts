/**
 * Pure TypeScript mobile API contract for #188's Expo UI. No Angular, Node,
 * provider or database dependencies. Never back this interface with AsyncStorage:
 * the production adapter must use expo-secure-store (iOS Keychain).
 */
export interface SecureSessionStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  remove(): Promise<void>;
}

export interface MobileAccount {
  id: string;
  displayName: string;
  email: string | null;
}

export interface MobileSession {
  account: MobileAccount;
  expiresAt: string;
  absoluteExpiresAt: string;
}

export interface MobileSignInStart {
  requestId: string;
  authorizationUrl: string;
  expiresAt: string;
}

export class MobileApiError extends Error {
  constructor(readonly kind: 'unauthorized' | 'forbidden' | 'network' | 'server' | 'invalid') {
    super(kind === 'unauthorized' ? 'Please sign in again.'
      : kind === 'forbidden' ? 'You do not have access to this action.'
      : kind === 'network' ? 'Cannot connect to SportOS.'
      : kind === 'invalid' ? 'Invalid mobile sign-in response.'
      : 'SportOS is temporarily unavailable.');
    this.name = 'MobileApiError';
  }
}

const MOBILE_TOKEN = /^smo_[A-Za-z0-9_-]{64}$/;
const RANDOM_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

export class MobileApiClient {
  private token: string | null = null;
  private readonly base: string;
  private readonly pending = new Set<AbortController>();

  constructor(
    baseUrl: string,
    private readonly store: SecureSessionStore,
    private readonly fetcher: typeof fetch = fetch,
    allowInsecureLocalhost = false,
  ) {
    const url = new URL(baseUrl);
    if (url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(allowInsecureLocalhost
        && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
      throw new MobileApiError('invalid');
    }
    this.base = url.toString().replace(/\/$/, '');
  }

  async startSignIn(codeChallenge: string, state: string): Promise<MobileSignInStart> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || !RANDOM_TOKEN.test(state)) {
      throw new MobileApiError('invalid');
    }
    return this.request('/auth/mobile/start', { method: 'POST', body: { codeChallenge, state }, public: true });
  }

  async finishSignIn(callbackUrl: string, expectedState: string, codeVerifier: string): Promise<MobileSession> {
    if (!RANDOM_TOKEN.test(expectedState) || !RANDOM_TOKEN.test(codeVerifier)) throw new MobileApiError('invalid');
    let url: URL;
    try { url = new URL(callbackUrl); } catch { throw new MobileApiError('invalid'); }
    if (url.protocol !== 'sportos:' || url.hostname !== 'auth' || url.pathname !== '/callback'
      || url.hash || url.searchParams.size !== 2
      || url.searchParams.get('state') !== expectedState
      || !RANDOM_TOKEN.test(url.searchParams.get('code') ?? '')) {
      throw new MobileApiError('invalid');
    }
    const response = await this.request<{ token: string } & MobileSession>('/auth/mobile/exchange', {
      method: 'POST',
      body: { code: url.searchParams.get('code'), state: expectedState, codeVerifier },
      public: true,
    });
    if (!MOBILE_TOKEN.test(response.token)) throw new MobileApiError('invalid');
    // A new mobile token is persisted only in secure storage.
    await this.store.write(response.token);
    this.token = response.token;
    return { account: response.account, expiresAt: response.expiresAt, absoluteExpiresAt: response.absoluteExpiresAt };
  }

  async restore(): Promise<MobileSession | null> {
    const token = await this.store.read();
    if (!token) return null;
    if (!MOBILE_TOKEN.test(token)) {
      await this.clear();
      return null;
    }
    this.token = token;
    try {
      return await this.request<MobileSession>('/auth/session');
    } catch (error) {
      if (error instanceof MobileApiError && error.kind === 'unauthorized') return null;
      throw error;
    }
  }

  /** Canonical API response; owner is always derived on the server. */
  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async mutate<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
    return this.request<T>(path, { method, body });
  }

  async signOut(): Promise<'revoked' | 'local-only'> {
    const current = this.token;
    // Clearing local access is mandatory even when the network is unavailable.
    await this.clear();
    if (!current) return 'local-only';
    try {
      const response = await this.fetcher(`${this.base}/auth/logout`, {
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: { Authorization: `Bearer ${current}`, Accept: 'application/json' },
      });
      return response.ok || response.status === 401 ? 'revoked' : 'local-only';
    } catch {
      return 'local-only';
    }
  }

  private async clear(): Promise<void> {
    this.token = null;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    await this.store.remove();
  }

  private async request<T>(path: string, options: {
    method?: 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    public?: boolean;
  } = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')
      || path.includes('#') || /[\\\r\n]/.test(path)) throw new MobileApiError('invalid');
    const token = options.public ? null : this.token;
    if (!options.public && !token) throw new MobileApiError('unauthorized');
    const controller = new AbortController();
    this.pending.add(controller);
    let response: Response;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.method ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(options.method ? { body: JSON.stringify(options.body ?? {}) } : {}),
      });
    } catch {
      throw new MobileApiError('network');
    } finally {
      this.pending.delete(controller);
    }
    if (token && token !== this.token) throw new MobileApiError('unauthorized');
    if (response.status === 401) {
      if (token) await this.clear();
      throw new MobileApiError('unauthorized');
    }
    if (response.status === 403) throw new MobileApiError('forbidden');
    if (!response.ok) throw new MobileApiError('server');
    try { return await response.json() as T; } catch { throw new MobileApiError('invalid'); }
  }
}
