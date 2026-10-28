import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { MobileApiClient, MobileApiError } from '../../../../packages/shared/src/mobile-api';
import type { MobileSession } from '../../../../packages/shared/src/mobile-api';
import { browserSignIn } from './native';

type Status = 'restoring' | 'signedOut' | 'signingIn' | 'authenticated' | 'unavailable' | 'locked';
interface SessionState {
  status: Status;
  session: MobileSession | null;
  message: string | null;
  retry(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  read<T>(path: string, signal?: AbortSignal): Promise<T>;
  mutate<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<T>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ client, children }: {
  client: MobileApiClient;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>('restoring');
  const [session, setSession] = useState<MobileSession | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true);
  const operation = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;
  const inFlight = useRef(false);

  const retry = useCallback(async () => {
    const current = ++operation.current;
    setMessage(null);
    setStatus('restoring');
    try {
      const restored = await client.restore();
      if (!alive.current || current !== operation.current) return;
      setSession(restored);
      setStatus(restored ? 'authenticated' : 'signedOut');
    } catch {
      if (!alive.current || current !== operation.current) return;
      // Offline restore must NOT create a phantom logged-in session.
      setSession(null);
      setStatus('unavailable');
      setMessage('Cannot check your session. Check your connection and retry.');
    }
  }, [client]);

  useEffect(() => {
    alive.current = true;
    void retry();
    return () => { alive.current = false; operation.current += 1; client.cancelRequests(); };
  }, [retry, client]);

  useEffect(() => {
    let suspended = false;
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active' && statusRef.current === 'authenticated') {
        suspended = true;
        operation.current += 1;
        client.cancelRequests();
        setSession(null);
        setStatus('locked');
      } else if (next === 'active' && suspended) {
        suspended = false;
        void retry();
      }
    });
    return () => listener.remove();
  }, [client, retry]);

  const signIn = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++operation.current;
    setMessage(null);
    setStatus('signingIn');
    try {
      const result = await browserSignIn(client);
      if (!alive.current || current !== operation.current) return;
      if (result) {
        setSession(result);
        setStatus('authenticated');
      } else {
        setStatus('signedOut');
      }
    } catch (error) {
      if (!alive.current || current !== operation.current) return;
      setSession(null);
      setStatus('signedOut');
      setMessage(error instanceof MobileApiError ? error.message : 'Could not complete sign-in. Try again.');
    } finally {
      inFlight.current = false;
    }
  }, [client]);

  const signOut = useCallback(async () => {
    operation.current += 1;
    // Immediately hide all private screens; server revocation can fail when offline.
    setSession(null);
    setStatus('signedOut');
    setMessage(null);
    try {
      const outcome = await client.signOut();
      if (alive.current && outcome === 'local-only') {
        setMessage('Signed out on this phone. Server revocation could not be confirmed offline; the remote session remains valid until it expires.');
      }
    } catch {
      if (alive.current) {
        // A SecureStore failure means device credentials may still be persisted.
        // Never claim local sign-out succeeded; keep private navigation hidden.
        setStatus('unavailable');
        setMessage('Could not clear the secure session on this device. Retry sign-out before handing over the phone.');
      }
    }
  }, [client]);

  useEffect(() => {
    if (status !== 'authenticated' || !session) return;
    const remaining = Date.parse(session.absoluteExpiresAt) - Date.now();
    const timer = setTimeout(() => { void signOut(); }, Math.max(0, Math.min(remaining, 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [session, status, signOut]);

  const read = useCallback(async <T,>(path: string, signal?: AbortSignal): Promise<T> => {
    try {
      return await client.get<T>(path, signal);
    } catch (error) {
      if (error instanceof MobileApiError && error.kind === 'unauthorized' && alive.current) {
        setSession(null);
        setStatus('signedOut');
        setMessage('Session expired. Sign in again.');
      }
      throw error;
    }
  }, [client]);

  const mutate = useCallback(async <T,>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<T> => {
    try {
      return await client.mutate<T>(path, method, body, signal);
    } catch (error) {
      if (error instanceof MobileApiError && error.kind === 'unauthorized' && alive.current) {
        setSession(null);
        setStatus('signedOut');
        setMessage('Session expired. Sign in again.');
      }
      throw error;
    }
  }, [client]);

  const value = useMemo(() => ({ status, session, message, retry, signIn, signOut, read, mutate }),
    [status, session, message, retry, signIn, signOut, read, mutate]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must run inside SessionProvider');
  return session;
}
