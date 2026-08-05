import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ProviderAuthorization, ProviderCode } from './provider-types.js';

export interface CredentialEnvelope { keyId: string; algorithm: 'aes-256-gcm'; nonce: string; ciphertext: string; authenticationTag: string; envelopeVersion: 1; }
export interface CredentialKeyRing { activeKeyId: string; keys: ReadonlyMap<string, Buffer>; }
interface SerializedAuthorization { providerAccountId: string; displayName: string | null; accessToken: string; refreshToken: string; expiresAt: string; scopes: string[]; }

export class CredentialCipher {
  constructor(private readonly keyRing: CredentialKeyRing) { requireKey(this.keyRing, this.keyRing.activeKeyId); }
  encrypt(connectionId: string, ownerId: string, provider: ProviderCode, authorization: ProviderAuthorization): CredentialEnvelope {
    const keyId = this.keyRing.activeKeyId;
    const key = requireKey(this.keyRing, keyId);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(additionalData(connectionId, ownerId, provider));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(serializeAuthorization(authorization)), 'utf8')), cipher.final()]);
    return { keyId, algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), authenticationTag: cipher.getAuthTag().toString('base64'), envelopeVersion: 1 };
  }
  decrypt(connectionId: string, ownerId: string, provider: ProviderCode, envelope: CredentialEnvelope): ProviderAuthorization {
    if (envelope.algorithm !== 'aes-256-gcm' || envelope.envelopeVersion !== 1) throw new Error('Unsupported provider credential envelope.');
    const decipher = createDecipheriv('aes-256-gcm', requireKey(this.keyRing, envelope.keyId), decodeBase64(envelope.nonce, 12, 'nonce'));
    decipher.setAAD(additionalData(connectionId, ownerId, provider));
    decipher.setAuthTag(decodeBase64(envelope.authenticationTag, 16, 'authentication tag'));
    try {
      const decoded = JSON.parse(Buffer.concat([decipher.update(decodeBase64(envelope.ciphertext, null, 'ciphertext')), decipher.final()]).toString('utf8')) as unknown;
      return deserializeAuthorization(decoded);
    } catch { throw new Error('Provider credential envelope authentication failed.'); }
  }
}

export function parseCredentialKeyRing(serialized: string, activeKeyId: string): CredentialKeyRing {
  const keys = new Map<string, Buffer>();
  for (const entry of serialized.split(',')) {
    const separator = entry.indexOf(':');
    if (separator <= 0) continue;
    const keyId = entry.slice(0, separator).trim();
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(keyId)) throw new Error('Invalid provider credential key id.');
    const key = decodeBase64(entry.slice(separator + 1).trim(), 32, `key ${keyId}`);
    if (keys.has(keyId)) throw new Error(`Duplicate provider credential key id ${keyId}.`);
    keys.set(keyId, key);
  }
  const normalizedActive = activeKeyId.trim();
  if (!normalizedActive || !keys.has(normalizedActive)) throw new Error('The active provider credential key is not present in the configured key ring.');
  return { activeKeyId: normalizedActive, keys };
}

function serializeAuthorization(input: ProviderAuthorization): SerializedAuthorization {
  return { providerAccountId: boundedText(input.providerAccountId, 200, 'provider account id'), displayName: input.displayName === null ? null : boundedText(input.displayName, 200, 'display name'), accessToken: boundedText(input.accessToken, 10_000, 'access token'), refreshToken: boundedText(input.refreshToken, 10_000, 'refresh token'), expiresAt: validDate(input.expiresAt, 'credential expiry').toISOString(), scopes: [...new Set(input.scopes.map((scope) => boundedText(scope, 100, 'scope')))].sort() };
}
function deserializeAuthorization(value: unknown): ProviderAuthorization {
  if (!isRecord(value)) throw new Error('Provider credential payload is invalid.');
  const scopes = Array.isArray(value.scopes) && value.scopes.every((scope) => typeof scope === 'string') ? value.scopes.map((scope) => boundedText(scope, 100, 'scope')) : null;
  if (!scopes) throw new Error('Provider credential scopes are invalid.');
  return { providerAccountId: boundedText(value.providerAccountId, 200, 'provider account id'), displayName: value.displayName === null ? null : boundedText(value.displayName, 200, 'display name'), accessToken: boundedText(value.accessToken, 10_000, 'access token'), refreshToken: boundedText(value.refreshToken, 10_000, 'refresh token'), expiresAt: validDate(value.expiresAt, 'credential expiry'), scopes: [...new Set(scopes)].sort() };
}
function additionalData(connectionId: string, ownerId: string, provider: ProviderCode): Buffer { return Buffer.from(JSON.stringify({ connectionId: boundedText(connectionId, 100, 'connection id'), ownerId: boundedText(ownerId, 100, 'owner id'), provider, envelopeVersion: 1 }), 'utf8'); }
function requireKey(keyRing: CredentialKeyRing, keyId: string): Buffer { const key = keyRing.keys.get(keyId); if (!key || key.length !== 32) throw new Error(`Provider credential key ${keyId} is unavailable.`); return key; }
function decodeBase64(value: string, exactLength: number | null, name: string): Buffer { if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`Invalid provider credential ${name}.`); const decoded = Buffer.from(value, 'base64'); if (!decoded.length || (exactLength !== null && decoded.length !== exactLength)) throw new Error(`Invalid provider credential ${name}.`); return decoded; }
function boundedText(value: unknown, maximum: number, name: string): string { if (typeof value !== 'string') throw new Error(`Invalid provider credential ${name}.`); const normalized = value.trim(); if (!normalized || normalized.length > maximum) throw new Error(`Invalid provider credential ${name}.`); return normalized; }
function validDate(value: unknown, name: string): Date { const date = value instanceof Date ? new Date(value.getTime()) : new Date(typeof value === 'string' ? value : Number.NaN); if (!Number.isFinite(date.getTime())) throw new Error(`Invalid provider ${name}.`); return date; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
