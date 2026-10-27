import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { MobileApiClient, MobileApiError } from '../../../../packages/shared/src/mobile-api';
import type { MobileSession, SecureSessionStore } from '../../../../packages/shared/src/mobile-api';
import { isExactOrigin, validAuthorizationUrl } from './url-policy.mjs';

const KEY = 'sportos.mobile.session.v1';
const REDIRECT = 'sportos://auth/callback';
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const sessionStore: SecureSessionStore = {
  read: () => SecureStore.getItemAsync(KEY),
  write: (token) => SecureStore.setItemAsync(KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }),
  remove: () => SecureStore.deleteItemAsync(KEY),
};

export function configuredClient(): MobileApiClient | null {
  const origin = process.env.EXPO_PUBLIC_SPORTOS_API_URL?.trim();
  const webOrigin = process.env.EXPO_PUBLIC_SPORTOS_WEB_ORIGIN?.trim();
  if (!origin || !webOrigin) return null;
  // Loopback is a deliberate simulator-only exception. Never allow it in a release build.
  const insecureLocal = __DEV__ && process.env.EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST === 'true';
  if (!isExactOrigin(origin, insecureLocal) || !isExactOrigin(webOrigin, insecureLocal)) return null;
  try {
    return new MobileApiClient(origin, sessionStore, fetch, insecureLocal);
  } catch {
    return null;
  }
}

function base64url(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    result += ABC[a >> 2] + ABC[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    if (b !== undefined) result += ABC[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    if (c !== undefined) result += ABC[c & 63];
  }
  return result.replace(/\+/g, '-').replace(/\//g, '_');
}

function plainToBase64Url(text: string): string {
  return text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair(): Promise<{ verifier: string; challenge: string; state: string }> {
  // Native CSPRNG; no Math.random or seeded pseudo-random fallback.
  const verifier = base64url(await Crypto.getRandomBytesAsync(32));
  const state = base64url(await Crypto.getRandomBytesAsync(32));
  const challenge = plainToBase64Url(await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  ));
  return { verifier, challenge, state };
}

/** System-browser approval and PKCE exchange; the verifier never enters an URL or persistent storage. */
export async function browserSignIn(client: MobileApiClient): Promise<MobileSession | null> {
  const { verifier, challenge, state } = await pkcePair();
  const start = await client.startSignIn(challenge, state);
  // The browser page can contain credentials. Refuse redirects outside our configured web host.
  if (!validAuthorizationUrl(start.authorizationUrl, process.env.EXPO_PUBLIC_SPORTOS_WEB_ORIGIN,
      __DEV__ && process.env.EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST === 'true')) {
    throw new MobileApiError('invalid');
  }

  const result = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, REDIRECT);
  if (result.type !== 'success') return null; // User cancelled; no persisted pending secret.
  return client.finishSignIn(result.url, state, verifier);
}
