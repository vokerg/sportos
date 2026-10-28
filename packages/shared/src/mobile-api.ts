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

/** Strict minimal session projection. Never retain arbitrary auth/server fields in UI state. */
function sessionProjection(value: unknown): MobileSession {
  if (!value || typeof value !== 'object') throw new MobileApiError('invalid');
  const raw = value as MobileSession;
  if (!raw.account || typeof raw.account.id !== 'string' || raw.account.id.length > 128
    || typeof raw.account.displayName !== 'string' || raw.account.displayName.length > 200
    || (raw.account.email !== null && (typeof raw.account.email !== 'string' || raw.account.email.length > 320))
    || typeof raw.expiresAt !== 'string' || !Number.isFinite(Date.parse(raw.expiresAt))
    || typeof raw.absoluteExpiresAt !== 'string' || !Number.isFinite(Date.parse(raw.absoluteExpiresAt))) {
    throw new MobileApiError('invalid');
  }
  return { account: { id: raw.account.id, displayName: raw.account.displayName, email: raw.account.email },
    expiresAt: raw.expiresAt, absoluteExpiresAt: raw.absoluteExpiresAt };
}

export class MobileApiClient {
  private token: string | null = null;
  private readonly base: string;
  private readonly pending = new Set<AbortController>();
  private generation = 0;

  constructor(
    baseUrl: string,
    private readonly store: SecureSessionStore,
    private readonly fetcher: typeof fetch = fetch,
    allowInsecureLocalhost = false,
    private readonly timeoutMs = 30_000,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new MobileApiError('invalid');
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
      || url.username || url.password || url.port || url.hash || Array.from(url.searchParams).length !== 2
      || url.searchParams.get('state') !== expectedState
      || !RANDOM_TOKEN.test(url.searchParams.get('code') ?? '')) {
      throw new MobileApiError('invalid');
    }
    const generation = this.generation;
    const response = await this.request<{ token: string } & MobileSession>('/auth/mobile/exchange', {
      method: 'POST',
      body: { code: url.searchParams.get('code'), state: expectedState, codeVerifier },
      public: true,
    });
    const session = sessionProjection(response);
    if (!MOBILE_TOKEN.test(response.token)) throw new MobileApiError('invalid');
    if (generation !== this.generation) throw new MobileApiError('unauthorized');
    // A new mobile token is persisted only in secure storage.
    await this.store.write(response.token);
    if (generation !== this.generation) {
      // Sign-out may have happened while Keychain persisted the new value.
      await this.store.remove();
      throw new MobileApiError('unauthorized');
    }
    this.token = response.token;
    return session;
  }

  async restore(): Promise<MobileSession | null> {
    const generation = this.generation;
    const token = await this.store.read();
    if (generation !== this.generation || !token) return null;
    if (!MOBILE_TOKEN.test(token)) {
      await this.clear();
      return null;
    }
    this.token = token;
    try {
      return sessionProjection(await this.request<unknown>('/auth/session'));
    } catch (error) {
      if (error instanceof MobileApiError && error.kind === 'unauthorized') return null;
      throw error;
    }
  }

  /** Canonical API response; owner is always derived on the server. */
  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, {signal});
  }

  async mutate<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<T> {
    return this.request<T>(path, { method, body, signal });
  }

  async signOut(): Promise<'revoked' | 'local-only'> {
    const generation = this.generation;
    const current = this.token ?? await this.store.read();
    if (generation !== this.generation) return 'local-only';
    // Clearing local access is mandatory even when the network is unavailable.
    await this.clear();
    if (!current || !MOBILE_TOKEN.test(current)) return 'local-only';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.base}/auth/logout`, {
        signal: controller.signal,
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        headers: { Authorization: `Bearer ${current}`, Accept: 'application/json' },
      });
      return response.ok || response.status === 401 ? 'revoked' : 'local-only';
    } catch {
      return 'local-only';
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Cancel private reads/mutations on background/navigation teardown without erasing Keychain. */
  cancelRequests(): void {
    this.generation += 1;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }

  private async clear(): Promise<void> {
    this.token = null;
    this.cancelRequests();
    await this.store.remove();
  }

  private async request<T>(path: string, options: {
    method?: 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    public?: boolean;
    signal?: AbortSignal;
  } = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')
      || path.includes('#') || /[\\\r\n]/.test(path)) throw new MobileApiError('invalid');
    if (options.signal?.aborted) throw new MobileApiError('network');
    const token = options.public ? null : this.token;
    if (!options.public && !token) throw new MobileApiError('unauthorized');
    const controller = new AbortController();
    const generation = this.generation;
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, {once:true});
    this.pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), options.method ? Math.max(this.timeoutMs, 120_000) : this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        method: options.method ?? 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.method ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(options.method ? { body: JSON.stringify(options.body ?? {}) } : {}),
      });
      if (generation !== this.generation || controller.signal.aborted) throw new MobileApiError('network');
      if (token && token !== this.token) throw new MobileApiError('unauthorized');
      if (response.status === 401) {
        if (token) {
          // Purge in-memory access even if the platform Keychain removal fails.
          try { await this.clear(); } catch { /* Expired credential cannot authorize reads. */ }
        }
        throw new MobileApiError('unauthorized');
      }
      if (response.status === 403) throw new MobileApiError('forbidden');
      if (!response.ok) throw new MobileApiError('server');
      let value: T;
      try { value = await response.json() as T; } catch { throw new MobileApiError('invalid'); }
      // Sign-out/background can race a streamed body even after response headers arrived.
      if (generation !== this.generation || controller.signal.aborted) throw new MobileApiError('network');
      return value;
    } catch (error) {
      if (error instanceof MobileApiError) throw error;
      throw new MobileApiError('network');
    } finally {
      clearTimeout(timeout);
      this.pending.delete(controller);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
